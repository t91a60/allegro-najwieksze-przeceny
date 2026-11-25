(function () {
  "use strict";

  const filter = globalThis.AllegroPrzecena;
  const STYLE_ID = "allegro-przecena-style";
  const BAR_ID = "allegro-przecena-bar";
  let enabled = true;
  let scanTimer = 0;
  let applying = false;
  let dirty = false;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#" + BAR_ID + "{position:fixed;right:16px;bottom:16px;z-index:2147483646;",
      "display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:999px;",
      "background:#1c120b;color:#fff7f2;font:600 14px/1.2 Segoe UI,sans-serif;",
      "box-shadow:0 10px 30px rgba(0,0,0,.28);}",
      "#" + BAR_ID + " button{border:0;border-radius:999px;padding:8px 12px;cursor:pointer;",
      "background:#ff5a00;color:#1c120b;font:700 14px/1 Segoe UI,sans-serif;}",
      "#" + BAR_ID + " span{font-weight:500;color:#ffd7c2;}",
      "[data-allegro-przecena]{position:relative;}",
      "[data-allegro-przecena]::after{content:attr(data-allegro-przecena);position:absolute;",
      "top:8px;left:8px;z-index:5;padding:3px 7px;border-radius:999px;",
      "background:#ff5a00;color:#1c120b;font:800 12px/1.2 Segoe UI,sans-serif;",
      "pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.25);}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function offerLinks(root) {
    return root.querySelectorAll('a[href*="/oferta/"], a[href*="/produkt/"]');
  }

  function cardFromLink(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 10 && node.parentElement; depth += 1) {
      const parent = node.parentElement;
      if (offerLinks(parent).length > 1) return node;
      node = parent;
    }
    return anchor.closest("article") || anchor;
  }

  function collectCards() {
    const seen = new Set();
    const cards = [];
    offerLinks(document).forEach((anchor) => {
      const card = cardFromLink(anchor);
      if (!card || seen.has(card) || card === document.body || card === document.documentElement) return;
      if (card.closest("#" + BAR_ID)) return;
      const text = card.innerText || "";
      if (!/zł/i.test(text)) return;
      const box = card.getBoundingClientRect();
      if (box.width < 80 || box.height < 60) return;
      seen.add(card);
      cards.push(card);
    });
    return cards.filter((card) => !cards.some((other) => other !== card && card.contains(other)));
  }

  function clearMarks() {
    document.querySelectorAll("[data-allegro-przecena]").forEach((card) => {
      card.removeAttribute("data-allegro-przecena");
    });
    document.querySelectorAll("[data-allegro-order-host]").forEach((host) => {
      host.style.order = "";
      host.removeAttribute("data-allegro-order-host");
    });
  }

  function mark(card, percent) {
    if (percent > 0) card.setAttribute("data-allegro-przecena", "−" + percent + "%");
    else card.removeAttribute("data-allegro-przecena");
  }

  function hostIn(parent, card) {
    let node = card;
    while (node.parentElement && node.parentElement !== parent) node = node.parentElement;
    return node.parentElement === parent ? node : null;
  }

  function listingGroups(cards) {
    const used = new Set();
    const groups = [];
    cards.forEach((card) => {
      if (used.has(card)) return;
      let node = card.parentElement;
      while (node && node !== document.body) {
        const inside = cards.filter((candidate) => node.contains(candidate));
        if (inside.length >= 2 && inside.every((candidate) => !used.has(candidate))) {
          const hosts = [];
          const seenHost = new Set();
          let ok = true;
          inside.forEach((candidate) => {
            const host = hostIn(node, candidate);
            if (!host || seenHost.has(host)) ok = false;
            else {
              seenHost.add(host);
              hosts.push({ host: host, card: candidate });
            }
          });
          if (ok && hosts.length >= 2) {
            inside.forEach((candidate) => used.add(candidate));
            groups.push({ parent: node, hosts: hosts });
            return;
          }
        }
        node = node.parentElement;
      }
    });
    return groups;
  }

  function sortGroup(group) {
    const ranked = group.hosts
      .map((entry, index) => ({
        host: entry.host,
        card: entry.card,
        index: index,
        percent: filter.discountFromText(entry.card.innerText || ""),
      }))
      .sort((a, b) => b.percent - a.percent || a.index - b.index);
    ranked.forEach((row) => mark(row.card, row.percent));
    const display = getComputedStyle(group.parent).display || "";
    if (/flex|grid/.test(display)) {
      ranked.forEach((row, index) => {
        row.host.style.order = String(index + 1);
        row.host.setAttribute("data-allegro-order-host", "1");
      });
      return ranked;
    }
    const current = group.hosts.map((entry) => entry.host);
    const same = ranked.every((row, index) => row.host === current[index]);
    if (!same) {
      const slots = current.map((host) => {
        const marker = document.createComment("przecena");
        host.replaceWith(marker);
        return marker;
      });
      ranked.forEach((row, index) => slots[index].replaceWith(row.host));
    }
    return ranked;
  }

  function updateBar(summary) {
    injectStyle();
    let bar = document.getElementById(BAR_ID);
    if (!bar) {
      bar = document.createElement("div");
      bar.id = BAR_ID;
      bar.innerHTML = '<button type="button"></button><span></span>';
      bar.querySelector("button").addEventListener("click", () => {
        enabled = !enabled;
        chrome.storage.local.set({ enabled: enabled });
        apply();
      });
      document.documentElement.appendChild(bar);
    }
    const button = bar.querySelector("button");
    const meta = bar.querySelector("span");
    button.textContent = enabled ? "Przecena: włączona" : "Przecena: wyłączona";
    if (!summary.total) {
      meta.textContent = "brak listy ofert";
      return;
    }
    meta.textContent = enabled
      ? summary.marked + " z " + summary.total + (summary.max ? " · max −" + summary.max + "%" : " · bez oznaczonej obniżki")
      : summary.total + " ofert w kolejności Allegro";
  }

  function apply() {
    if (!filter || applying) return;
    applying = true;
    try {
      injectStyle();
      const cards = collectCards();
      if (!enabled) {
        clearMarks();
        updateBar({ total: cards.length, marked: 0, max: 0 });
        return { enabled: enabled, total: cards.length, marked: 0, max: 0 };
      }
      clearMarks();
      let marked = 0;
      let max = 0;
      listingGroups(cards).forEach((group) => {
        sortGroup(group).forEach((row) => {
          if (row.percent > 0) marked += 1;
          if (row.percent > max) max = row.percent;
        });
      });
      const summary = { enabled: true, total: cards.length, marked: marked, max: max };
      updateBar(summary);
      return summary;
    } finally {
      applying = false;
      if (dirty) {
        dirty = false;
        schedule();
      }
    }
  }

  function schedule() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(apply, 80);
  }

  chrome.storage.local.get({ enabled: true }, (data) => {
    enabled = data.enabled !== false;
    schedule();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.enabled) return;
    enabled = changes.enabled.newValue !== false;
    schedule();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "GET_STATE") return;
    const summary = apply() || { enabled: enabled, total: 0, marked: 0, max: 0 };
    sendResponse(summary);
  });

  const observer = new MutationObserver(() => {
    if (applying) dirty = true;
    else schedule();
  });

  function start() {
    injectStyle();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    schedule();
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });

  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function () {
    const result = push.apply(this, arguments);
    schedule();
    return result;
  };
  history.replaceState = function () {
    const result = replace.apply(this, arguments);
    schedule();
    return result;
  };
  window.addEventListener("popstate", schedule);
})();
