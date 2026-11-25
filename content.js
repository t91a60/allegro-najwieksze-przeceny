(function () {
  "use strict";

  if (globalThis.__allegroPrzecenaLoaded) return;
  globalThis.__allegroPrzecenaLoaded = true;

  const filter = globalThis.AllegroPrzecena;
  const STYLE_ID = "allegro-przecena-style";
  let enabled = true;
  let applying = false;
  let scanTimer = 0;
  let lastSummary = { enabled: true, total: 0, marked: 0, max: 0 };

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = "[data-allegro-przecena]{box-shadow:inset 0 0 0 2px #ff5a00;}";
    (document.head || document.documentElement).appendChild(style);
  }

  function offerLinks(root) {
    return root.querySelectorAll('a[href*="/oferta/"], a[href*="/produkt/"], a[href*="allegro.pl/oferta"], a[href*="allegro.pl/produkt"]');
  }

  function isCardSized(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const box = el.getBoundingClientRect();
    if (box.width < 100 || box.height < 60) return false;
    if (box.height > 760) return false;
    if (box.width > window.innerWidth * 0.96) return false;
    if (box.width > window.innerWidth * 0.8 && box.height > window.innerHeight * 0.35) return false;
    return true;
  }

  function cardFromLink(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 10 && node.parentElement; depth += 1) {
      const parent = node.parentElement;
      if (offerLinks(parent).length > 1) {
        if (offerLinks(node).length > 2) return null;
        if (!isCardSized(node)) return null;
        return node;
      }
      node = parent;
    }
    return null;
  }

  function collectCards() {
    const seen = new Set();
    const cards = [];
    offerLinks(document).forEach((anchor) => {
      const card = cardFromLink(anchor);
      if (!card || seen.has(card)) return;
      if (!/zł/i.test(card.innerText || "")) return;
      seen.add(card);
      cards.push(card);
    });
    return cards.filter((card) => !cards.some((other) => other !== card && card.contains(other)));
  }

  function clearMarks() {
    document.querySelectorAll("[data-allegro-przecena]").forEach((card) => {
      card.removeAttribute("data-allegro-przecena");
    });
    document.querySelectorAll("[data-allegro-order]").forEach((item) => {
      item.style.removeProperty("order");
      item.removeAttribute("data-allegro-order");
    });
  }

  function mark(card, percent) {
    if (percent > 0) card.setAttribute("data-allegro-przecena", "−" + percent + "%");
    else card.removeAttribute("data-allegro-przecena");
  }

  function gridItem(card) {
    let node = card;
    while (node.parentElement && node !== document.body) {
      const display = getComputedStyle(node.parentElement).display || "";
      if (display.indexOf("flex") !== -1 || display.indexOf("grid") !== -1) {
        const box = node.getBoundingClientRect();
        const huge = box.width > window.innerWidth * 0.9 && box.height > window.innerHeight * 0.4;
        if (huge || box.height > 900) return null;
        return node;
      }
      node = node.parentElement;
    }
    return card.parentElement ? card : null;
  }

  function paintOrder(entries) {
    entries.forEach((row, index) => {
      const item = gridItem(row.card);
      if (!item) return;
      item.style.order = String(index + 1);
      item.setAttribute("data-allegro-order", "1");
    });
  }

  function sortSiblings(cards) {
    const parent = cards[0].parentElement;
    if (!parent || cards.some((card) => card.parentElement !== parent)) return [];
    const ranked = cards
      .map((card, index) => ({
        card: card,
        index: index,
        percent: filter.discountFromText(card.innerText || ""),
      }))
      .sort((a, b) => b.percent - a.percent || a.index - b.index);
    const same = ranked.every((row, index) => row.card === cards[index]);
    if (!same) {
      const markers = cards.map((card) => {
        const marker = document.createComment("przecena");
        card.replaceWith(marker);
        return marker;
      });
      ranked.forEach((row, index) => markers[index].replaceWith(row.card));
    }
    ranked.forEach((row) => mark(row.card, row.percent));
    paintOrder(ranked);
    return ranked;
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
      if (!enabled) {
        clearMarks();
        return publish({ enabled: false, total: 0, marked: 0, max: 0 });
      }
      const groups = new Map();
      collectCards().forEach((card) => {
        const parent = card.parentElement;
        if (!parent) return;
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent).push(card);
      });
      let marked = 0;
      let max = 0;
      let total = 0;
      groups.forEach((cards) => {
        if (cards.length < 2) return;
        sortSiblings(cards).forEach((row) => {
          total += 1;
          if (row.percent > 0) marked += 1;
          if (row.percent > max) max = row.percent;
        });
      });
      return publish({ enabled: true, total: total, marked: marked, max: max });
    } finally {
      applying = false;
    }
  }

  function schedule() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(apply, 200);
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
    if (!enabled || applying) return;
    schedule();
  });

  function start() {
    injectStyle();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setInterval(() => {
      if (enabled && !applying) apply();
    }, 700);
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
