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
    style.textContent = [
      "[data-allegro-przecena]{outline:2px solid #ff5a00;outline-offset:-2px;}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function offerLinks(root) {
    return root.querySelectorAll('a[href*="/oferta/"], a[href*="/produkt/"]');
  }

  function isReasonableCard(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const box = el.getBoundingClientRect();
    if (box.width < 90 || box.height < 50) return false;
    if (box.width > window.innerWidth * 0.92 && box.height > window.innerHeight * 0.45) return false;
    if (box.height > 900) return false;
    return true;
  }

  function cardFromLink(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 8 && node.parentElement; depth += 1) {
      const parent = node.parentElement;
      const links = offerLinks(parent);
      if (links.length > 1) {
        if (offerLinks(node).length <= 2 && isReasonableCard(node)) return node;
        return null;
      }
      node = parent;
    }
    const article = anchor.closest("article");
    if (article && offerLinks(article).length <= 2 && isReasonableCard(article)) return article;
    return null;
  }

  function cardText(card) {
    return card.innerText || "";
  }

  function collectCards() {
    const seen = new Set();
    const cards = [];
    offerLinks(document).forEach((anchor) => {
      const card = cardFromLink(anchor);
      if (!card || seen.has(card)) return;
      if (!/zł/i.test(cardText(card))) return;
      seen.add(card);
      cards.push(card);
    });
    return cards.filter((card) => !cards.some((other) => other !== card && card.contains(other)));
  }

  function gridItem(card) {
    let node = card;
    while (node.parentElement && node !== document.body) {
      const display = getComputedStyle(node.parentElement).display || "";
      if (display.indexOf("flex") !== -1 || display.indexOf("grid") !== -1) {
        if (!isReasonableCard(node) && node !== card) return null;
        return { parent: node.parentElement, item: node };
      }
      node = node.parentElement;
    }
    return null;
  }

  function clearOrder() {
    document.querySelectorAll("[data-allegro-order]").forEach((item) => {
      item.style.removeProperty("order");
      item.removeAttribute("data-allegro-order");
    });
    document.querySelectorAll("[data-allegro-przecena]").forEach((card) => {
      card.removeAttribute("data-allegro-przecena");
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
      if (!enabled) {
        clearOrder();
        return publish({ enabled: false, total: 0, marked: 0, max: 0 });
      }
      const cards = collectCards();
      const groups = new Map();
      cards.forEach((card) => {
        const placed = gridItem(card);
        if (!placed) return;
        if (!groups.has(placed.parent)) groups.set(placed.parent, []);
        groups.get(placed.parent).push({ card: card, item: placed.item });
      });
      let marked = 0;
      let max = 0;
      let total = 0;
      groups.forEach((entries) => {
        if (entries.length < 2) return;
        const ranked = entries
          .map((entry, index) => ({
            entry: entry,
            index: index,
            percent: filter.discountFromText(cardText(entry.card)),
          }))
          .sort((a, b) => b.percent - a.percent || a.index - b.index);
        ranked.forEach((row, index) => {
          total += 1;
          if (row.percent > 0) marked += 1;
          if (row.percent > max) max = row.percent;
          row.entry.item.style.order = String(index + 1);
          row.entry.item.setAttribute("data-allegro-order", "1");
          if (row.percent > 0) row.entry.card.setAttribute("data-allegro-przecena", "−" + row.percent + "%");
          else row.entry.card.removeAttribute("data-allegro-przecena");
        });
      });
      return publish({ enabled: true, total: total, marked: marked, max: max });
    } finally {
      applying = false;
    }
  }

  function schedule() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(apply, 250);
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
