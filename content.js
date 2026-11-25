(function () {
  "use strict";

  if (globalThis.__allegroPrzecenaLoaded) return;
  globalThis.__allegroPrzecenaLoaded = true;

  const filter = globalThis.AllegroPrzecena;
  const STYLE_ID = "allegro-przecena-style";
  const BOARD_ID = "allegro-przecena-board";
  const origin = new WeakMap();
  let enabled = true;
  let applying = false;
  let scanTimer = 0;
  let homeSeq = 0;
  let lastSummary = { enabled: true, total: 0, marked: 0, max: 0 };

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#" + BOARD_ID + "{display:flex !important;flex-wrap:wrap !important;align-items:flex-start !important;align-content:flex-start !important;width:100%;gap:12px;}",
      "[data-allegro-przecena]{box-shadow:inset 0 0 0 3px #ff5a00;}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function offerLinks(root) {
    return root.querySelectorAll(
      'a[href*="/oferta/"], a[href*="/produkt/"], a[href*="allegro.pl/oferta"], a[href*="allegro.pl/produkt"]',
    );
  }

  function inCarousel(el) {
    let node = el;
    while (node && node !== document.body) {
      const name = (node.getAttribute && node.getAttribute("data-box-name")) || "";
      if (/carousel|slider|reco/i.test(name)) return true;
      const style = getComputedStyle(node);
      if ((style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollWidth > node.clientWidth + 48) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function isHuge(el) {
    const box = el.getBoundingClientRect();
    if (box.height > 1100) return true;
    if (box.width > window.innerWidth * 0.98 && box.height > window.innerHeight * 0.4) return true;
    return false;
  }

  function looksLikeCard(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.id === BOARD_ID) return false;
    if (el.matches("a, script, style, link")) return false;
    if (isHuge(el)) return false;
    const box = el.getBoundingClientRect();
    if (box.width >= 80 && box.height >= 36 && box.height < 1000 && box.width <= window.innerWidth * 0.98) return true;
    if (box.width === 0 && box.height === 0 && offerLinks(el).length > 0 && /zł/i.test(el.innerText || "")) return true;
    return false;
  }

  function cardFromLink(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 16 && node.parentElement; depth += 1) {
      const parent = node.parentElement;
      const nodeLinks = offerLinks(node).length + (node.matches("a[href]") ? 1 : 0);
      if (offerLinks(parent).length > nodeLinks && looksLikeCard(node)) return node;
      node = parent;
    }
    return null;
  }

  function collectCards() {
    const seen = new Set();
    const cards = [];
    offerLinks(document).forEach((anchor) => {
      if (inCarousel(anchor)) return;
      const card = cardFromLink(anchor);
      if (!card || seen.has(card) || inCarousel(card)) return;
      if (!/zł/i.test(card.innerText || "")) return;
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
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.id === BOARD_ID) {
          node = node.parentElement;
          continue;
        }
        counts.set(node, (counts.get(node) || 0) + 1);
        node = node.parentElement;
      }
    });
    let best = null;
    let bestCount = 0;
    let bestDepth = -1;
    counts.forEach((count, node) => {
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
    if (origin.has(card) || !card.parentElement || card.parentElement.id === BOARD_ID) return;
    homeSeq += 1;
    card.dataset.allegroSeq = String(homeSeq);
    origin.set(card, card.parentElement);
  }

  function lockWidth(card) {
    if (card.dataset.allegroW) return;
    const width = Math.round(card.getBoundingClientRect().width);
    if (width >= 80 && width <= window.innerWidth * 0.96) card.dataset.allegroW = String(width);
  }

  function applyWidth(card) {
    const width = Number(card.dataset.allegroW);
    if (!width) return;
    const basis = width + "px";
    card.style.setProperty("flex", "0 0 " + basis, "important");
    card.style.setProperty("width", basis, "important");
    card.style.setProperty("max-width", "100%", "important");
  }

  function ensureBoard(root, cards) {
    let board = document.getElementById(BOARD_ID);
    if (!board) {
      board = document.createElement("div");
      board.id = BOARD_ID;
    }
    if (board.parentElement !== root) {
      const anchor = cards.find((card) => root.contains(card) && !board.contains(card));
      if (anchor) anchor.parentElement.insertBefore(board, anchor);
      else root.insertBefore(board, root.firstChild);
    }
    return board;
  }

  function clearCard(card) {
    card.style.removeProperty("flex");
    card.style.removeProperty("width");
    card.style.removeProperty("max-width");
    card.style.removeProperty("order");
    card.removeAttribute("data-allegro-przecena");
  }

  function restore() {
    const cards = collectCards();
    const groups = new Map();
    cards.forEach((card) => {
      clearCard(card);
      const parent = origin.get(card);
      if (!parent || !parent.isConnected) return;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(card);
    });
    groups.forEach((list, parent) => {
      list.sort((a, b) => Number(a.dataset.allegroSeq) - Number(b.dataset.allegroSeq));
      list.forEach((card) => parent.appendChild(card));
    });
    const board = document.getElementById(BOARD_ID);
    if (board) board.remove();
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
      if (!root) return publish({ enabled: true, total: 0, marked: 0, max: 0 });
      const inside = cards.filter((card) => root.contains(card) || card.parentElement?.id === BOARD_ID);
      if (inside.length < 2) return publish({ enabled: true, total: inside.length, marked: 0, max: 0 });
      inside.forEach((card) => {
        remember(card);
        lockWidth(card);
      });
      const board = ensureBoard(root, inside);
      const ranked = inside
        .map((card, index) => ({
          card: card,
          index: index,
          percent: filter.discountFromText(card.innerText || ""),
        }))
        .sort((a, b) => b.percent - a.percent || a.index - b.index);
      const placed = ranked.map((row) => row.card);
      const sameParent = placed.every((card) => card.parentElement === board);
      const sameOrder = sameParent && placed.every((card, index) => board.children[index] === card);
      if (!sameOrder) placed.forEach((card) => board.appendChild(card));
      let marked = 0;
      let max = 0;
      ranked.forEach((row, index) => {
        applyWidth(row.card);
        row.card.style.setProperty("order", String(index + 1), "important");
        if (row.percent > 0) {
          marked += 1;
          row.card.setAttribute("data-allegro-przecena", "−" + row.percent + "%");
        } else row.card.removeAttribute("data-allegro-przecena");
        if (row.percent > max) max = row.percent;
      });
      return publish({ enabled: true, total: ranked.length, marked: marked, max: max });
    } finally {
      applying = false;
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

  const observer = new MutationObserver((records) => {
    if (!enabled || applying) return;
    const added = records.some((record) => record.addedNodes && record.addedNodes.length);
    if (!added) return;
    schedule();
  });

  function start() {
    injectStyle();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.setInterval(() => {
      if (enabled && !applying) apply();
    }, 400);
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
