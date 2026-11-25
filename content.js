(function () {
  "use strict";

  if (globalThis.__allegroPrzecenaLoaded) return;
  globalThis.__allegroPrzecenaLoaded = true;

  const filter = globalThis.AllegroPrzecena;
  const STYLE_ID = "allegro-przecena-style";
  let enabled = true;
  let seq = 0;
  let scanTimer = 0;
  let applying = false;
  let dirty = false;
  let lastSummary = { enabled: true, total: 0, marked: 0, max: 0 };

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
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
      const text = cardText(card);
      if (!/zł/i.test(text)) return;
      const box = card.getBoundingClientRect();
      if (box.width < 80 || box.height < 40) return;
      seen.add(card);
      cards.push(card);
    });
    return cards.filter((card) => !cards.some((other) => other !== card && card.contains(other)));
  }

  function cardText(card) {
    const bits = [card.innerText || ""];
    card.querySelectorAll("[aria-label]").forEach((node) => {
      bits.push(node.getAttribute("aria-label") || "");
    });
    return bits.join("\n");
  }

  function hostIn(parent, card) {
    let node = card;
    while (node.parentElement && node.parentElement !== parent) node = node.parentElement;
    return node.parentElement === parent ? node : null;
  }

  function stamp(host) {
    if (!host.dataset.allegroSeq) {
      seq += 1;
      host.dataset.allegroSeq = String(seq);
    }
    return Number(host.dataset.allegroSeq);
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
            groups.push({ hosts: hosts });
            return;
          }
        }
        node = node.parentElement;
      }
    });
    return groups;
  }

  function mark(card, percent) {
    if (percent > 0) card.setAttribute("data-allegro-przecena", "−" + percent + "%");
    else card.removeAttribute("data-allegro-przecena");
  }

  function reorder(current, desired) {
    const same = desired.every((host, index) => host === current[index]);
    if (same) return;
    const slots = current.map((host) => {
      const marker = document.createComment("przecena");
      host.replaceWith(marker);
      return marker;
    });
    desired.forEach((host, index) => slots[index].replaceWith(host));
  }

  function sortGroup(group) {
    const ranked = group.hosts
      .map((entry) => ({
        host: entry.host,
        card: entry.card,
        seq: stamp(entry.host),
        percent: filter.discountFromText(cardText(entry.card)),
      }))
      .sort((a, b) => b.percent - a.percent || a.seq - b.seq);
    ranked.forEach((row) => mark(row.card, row.percent));
    reorder(
      group.hosts.map((entry) => entry.host),
      ranked.map((row) => row.host),
    );
    return ranked;
  }

  function clearBadges() {
    document.querySelectorAll("[data-allegro-przecena]").forEach((card) => {
      card.removeAttribute("data-allegro-przecena");
    });
    document.querySelectorAll("[data-allegro-order-host]").forEach((host) => {
      host.style.order = "";
      host.removeAttribute("data-allegro-order-host");
    });
  }

  function restoreOrder() {
    clearBadges();
    const groups = new Map();
    document.querySelectorAll("[data-allegro-seq]").forEach((host) => {
      const parent = host.parentElement;
      if (!parent) return;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(host);
    });
    groups.forEach((hosts) => {
      const original = hosts.slice().sort((a, b) => Number(a.dataset.allegroSeq) - Number(b.dataset.allegroSeq));
      reorder(hosts, original);
    });
  }

  function publish(summary) {
    lastSummary = summary;
    try {
      chrome.runtime.sendMessage({
        type: "BADGE",
        text: summary.enabled && summary.max ? String(summary.max) : "",
      });
    } catch (error) {
      /* popup bywa zamknięty, a worker jeszcze nie wstał */
    }
    return summary;
  }

  function apply() {
    if (!filter || applying) return lastSummary;
    applying = true;
    try {
      injectStyle();
      const cards = collectCards();
      if (!enabled) {
        restoreOrder();
        return publish({ enabled: false, total: cards.length, marked: 0, max: 0 });
      }
      let marked = 0;
      let max = 0;
      clearBadges();
      listingGroups(cards).forEach((group) => {
        sortGroup(group).forEach((row) => {
          if (row.percent > 0) marked += 1;
          if (row.percent > max) max = row.percent;
        });
      });
      return publish({ enabled: true, total: cards.length, marked: marked, max: max });
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
    scanTimer = window.setTimeout(apply, 120);
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
    if (!message) return;
    if (message.type === "SET_ENABLED") enabled = message.enabled !== false;
    if (message.type !== "GET_STATE" && message.type !== "SET_ENABLED") return;
    sendResponse(apply());
  });

  const observer = new MutationObserver(() => {
    if (!enabled) return;
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
