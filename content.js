(function () {
  "use strict";

  if (globalThis.__allegroPrzecenaLoaded) return;
  globalThis.__allegroPrzecenaLoaded = true;

  const filter = globalThis.AllegroPrzecena;
  const STYLE_ID = "allegro-przecena-style";
  const origin = new WeakMap();
  let enabled = true;
  let seq = 0;
  let applying = false;
  let lastSummary = { enabled: true, total: 0, marked: 0, max: 0 };
  let nextPass = 0;

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
    for (let depth = 0; depth < 12 && node.parentElement; depth += 1) {
      const parent = node.parentElement;
      if (offerLinks(parent).length > 1) return node;
      node = parent;
    }
    return anchor.closest("article") || anchor;
  }

  function cardText(card) {
    const bits = [card.innerText || "", card.textContent || ""];
    card.querySelectorAll("[aria-label], img[alt]").forEach((node) => {
      bits.push(node.getAttribute("aria-label") || node.getAttribute("alt") || "");
    });
    return bits.join("\n");
  }

  function collectCards() {
    const seen = new Set();
    const cards = [];
    offerLinks(document).forEach((anchor) => {
      const card = cardFromLink(anchor);
      if (!card || seen.has(card) || card === document.body || card === document.documentElement) return;
      if (!/zł/i.test(cardText(card))) return;
      if (card.offsetWidth === 0 && card.offsetHeight === 0) return;
      seen.add(card);
      cards.push(card);
    });
    return cards.filter((card) => !cards.some((other) => other !== card && card.contains(other)));
  }

  function depthOf(node) {
    let depth = 0;
    let current = node;
    while (current && current.parentElement) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }

  function feedRoot(cards) {
    const counts = new Map();
    cards.forEach((card) => {
      let node = card.parentElement;
      while (node && node !== document.documentElement) {
        counts.set(node, (counts.get(node) || 0) + 1);
        node = node.parentElement;
      }
    });
    let best = null;
    let bestCount = 0;
    let bestDepth = -1;
    counts.forEach((count, node) => {
      if (count < 2) return;
      const depth = depthOf(node);
      if (count > bestCount || (count === bestCount && depth > bestDepth)) {
        best = node;
        bestCount = count;
        bestDepth = depth;
      }
    });
    return best;
  }

  function remember(card) {
    if (card.dataset.allegroSeq) return;
    const parent = card.parentElement;
    seq += 1;
    card.dataset.allegroSeq = String(seq);
    origin.set(card, {
      parent: parent,
      index: parent ? Array.prototype.indexOf.call(parent.children, card) : 0,
    });
  }

  function mark(card, percent) {
    if (percent > 0) card.setAttribute("data-allegro-przecena", "−" + percent + "%");
    else card.removeAttribute("data-allegro-przecena");
  }

  function clearPaint(cards) {
    cards.forEach((card) => {
      card.style.removeProperty("order");
      card.removeAttribute("data-allegro-przecena");
    });
    document.querySelectorAll("[data-allegro-display-saved]").forEach((parent) => {
      parent.style.removeProperty("display");
      parent.style.removeProperty("flex-wrap");
      parent.style.removeProperty("align-items");
      if (parent.dataset.allegroDisplay) parent.style.display = parent.dataset.allegroDisplay;
      delete parent.dataset.allegroDisplay;
      delete parent.dataset.allegroDisplaySaved;
    });
  }

  function layoutParent(parent, cards) {
    if (!parent) return;
    const display = getComputedStyle(parent).display || "";
    if (/flex|grid/.test(display)) return;
    const kids = Array.prototype.filter.call(parent.children, (child) => cards.indexOf(child) !== -1);
    if (kids.length < 2 || kids.length < parent.children.length * 0.4) return;
    if (!parent.dataset.allegroDisplaySaved) {
      parent.dataset.allegroDisplaySaved = "1";
      parent.dataset.allegroDisplay = parent.style.display || "";
    }
    parent.style.setProperty("display", "flex", "important");
    parent.style.setProperty("flex-wrap", "wrap", "important");
    parent.style.setProperty("align-items", "stretch", "important");
  }

  function place(current, ranked) {
    const same = ranked.every((row, index) => row.card === current[index]);
    if (same) return false;
    const markers = current.map((card) => {
      const marker = document.createComment("przecena");
      card.replaceWith(marker);
      return marker;
    });
    ranked.forEach((row, index) => markers[index].replaceWith(row.card));
    return true;
  }

  function restore() {
    const cards = collectCards();
    clearPaint(cards);
    const groups = new Map();
    cards.forEach((card) => {
      const info = origin.get(card);
      if (!info || !info.parent || !info.parent.isConnected) return;
      if (!groups.has(info.parent)) groups.set(info.parent, []);
      groups.get(info.parent).push(info);
    });
    groups.forEach((list, parent) => {
      list.sort((a, b) => a.index - b.index);
      list.forEach((info) => {
        const ref = parent.children[info.index] || null;
        if (info.card !== ref) parent.insertBefore(info.card, ref);
      });
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
      /* worker może jeszcze spać */
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
        restore();
        return publish({ enabled: false, total: cards.length, marked: 0, max: 0 });
      }
      const root = feedRoot(cards);
      const inside = root ? cards.filter((card) => root.contains(card)) : [];
      inside.forEach(remember);
      const ranked = inside
        .map((card) => ({
          card: card,
          seq: Number(card.dataset.allegroSeq) || 0,
          percent: filter.discountFromText(cardText(card)),
        }))
        .sort((a, b) => b.percent - a.percent || a.seq - b.seq);
      place(inside, ranked);
      const parents = new Set();
      ranked.forEach((row, index) => {
        mark(row.card, row.percent);
        row.card.style.setProperty("order", String(index + 1), "important");
        if (row.card.parentElement) parents.add(row.card.parentElement);
      });
      parents.forEach((parent) => layoutParent(parent, ranked.map((row) => row.card)));
      let marked = 0;
      let max = 0;
      ranked.forEach((row) => {
        if (row.percent > 0) marked += 1;
        if (row.percent > max) max = row.percent;
      });
      return publish({ enabled: enabled, total: inside.length, marked: marked, max: max });
    } finally {
      applying = false;
    }
  }

  function schedule(delay) {
    const wait = typeof delay === "number" ? delay : 60;
    window.setTimeout(apply, wait);
  }

  chrome.storage.local.get({ enabled: true }, (data) => {
    enabled = data.enabled !== false;
    schedule(0);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.enabled) return;
    enabled = changes.enabled.newValue !== false;
    schedule(0);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return;
    if (message.type === "SET_ENABLED") enabled = message.enabled !== false;
    if (message.type !== "GET_STATE" && message.type !== "SET_ENABLED") return;
    sendResponse(apply());
  });

  const observer = new MutationObserver(() => {
    if (!enabled || applying) return;
    schedule(40);
  });

  function start() {
    injectStyle();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("scroll", () => schedule(30), true);
    const tick = (time) => {
      if (enabled && !applying && time >= nextPass) {
        nextPass = time + 100;
        apply();
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
    schedule(0);
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });

  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function () {
    const result = push.apply(this, arguments);
    schedule(0);
    return result;
  };
  history.replaceState = function () {
    const result = replace.apply(this, arguments);
    schedule(0);
    return result;
  };
  window.addEventListener("popstate", () => schedule(0));
})();
