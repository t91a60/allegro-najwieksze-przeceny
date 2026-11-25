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
    style.textContent = "[data-allegro-przecena]{box-shadow:inset 0 0 0 3px #ff5a00;}";
    (document.head || document.documentElement).appendChild(style);
  }

  function offerLinks(root) {
    return root.querySelectorAll(
      'a[href*="/oferta/"], a[href*="/produkt/"], a[href*="allegro.pl/oferta"], a[href*="allegro.pl/produkt"]',
    );
  }

  function displayOf(el) {
    return (el && getComputedStyle(el).display) || "";
  }

  function realParent(el) {
    let parent = el.parentElement;
    while (parent && displayOf(parent) === "contents") parent = parent.parentElement;
    return parent;
  }

  function slotOf(container, card) {
    let node = card;
    while (node && realParent(node) !== container) node = node.parentElement;
    return node && realParent(node) === container ? node : null;
  }

  function boxOf(el) {
    return el.getBoundingClientRect();
  }

  function isHuge(el) {
    const box = boxOf(el);
    if (box.height > 1100) return true;
    if (box.width > window.innerWidth * 0.98 && box.height > window.innerHeight * 0.45) return true;
    return false;
  }

  function isCard(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (isHuge(el)) return false;
    const box = boxOf(el);
    if (box.width < 80 || box.height < 40) return false;
    if (box.width > window.innerWidth * 0.98) return false;
    return true;
  }

  function cardFromLink(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 14 && node.parentElement; depth += 1) {
      const parent = node.parentElement;
      const nodeLinks = offerLinks(node).length + (node.matches && node.matches("a[href]") ? 1 : 0);
      if (offerLinks(parent).length > nodeLinks && isCard(node)) return node;
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

  function groupsOf(cards) {
    const seen = new Set();
    const groups = [];
    cards.forEach((card) => {
      let node = realParent(card);
      while (node && node !== document.body && node !== document.documentElement) {
        if (!seen.has(node)) {
          seen.add(node);
          const pairs = [];
          const used = new Set();
          let ok = true;
          cards.forEach((candidate) => {
            if (!ok || !node.contains(candidate)) return;
            const slot = slotOf(node, candidate);
            if (!slot || used.has(slot) || isHuge(slot)) {
              ok = false;
              return;
            }
            used.add(slot);
            pairs.push({ slot: slot, card: candidate });
          });
          if (ok && pairs.length >= 2) groups.push({ parent: node, pairs: pairs });
        }
        node = realParent(node);
      }
    });
    groups.sort((a, b) => b.pairs.length - a.pairs.length);
    const kept = [];
    groups.forEach((group) => {
      if (kept.some((other) => other.parent.contains(group.parent) || group.parent.contains(other.parent))) return;
      kept.push(group);
    });
    return kept;
  }

  function clearMarks() {
    document.querySelectorAll("[data-allegro-order]").forEach((slot) => {
      slot.style.removeProperty("order");
      slot.style.removeProperty("flex");
      slot.style.removeProperty("width");
      slot.style.removeProperty("max-width");
      slot.removeAttribute("data-allegro-order");
    });
    document.querySelectorAll("[data-allegro-flex]").forEach((parent) => {
      parent.style.removeProperty("display");
      parent.style.removeProperty("flex-wrap");
      parent.style.removeProperty("align-items");
      parent.removeAttribute("data-allegro-flex");
    });
    document.querySelectorAll("[data-allegro-przecena]").forEach((card) => {
      card.removeAttribute("data-allegro-przecena");
    });
  }

  function layout(group, ranked) {
    const parent = group.parent;
    const display = displayOf(parent);
    const canOrder = /flex|grid/.test(display) || parent.hasAttribute("data-allegro-flex");
    if (!canOrder) {
      const kids = parent.children.length || 1;
      if (ranked.length / kids < 0.55) return;
      parent.setAttribute("data-allegro-flex", "1");
      parent.style.setProperty("display", "flex", "important");
      parent.style.setProperty("flex-wrap", "wrap", "important");
      parent.style.setProperty("align-items", "flex-start", "important");
      ranked.forEach((row) => {
        const width = Math.round(boxOf(row.slot).width);
        if (width < 80 || width > window.innerWidth * 0.96) return;
        const basis = width + "px";
        row.slot.style.setProperty("flex", "0 0 " + basis, "important");
        row.slot.style.setProperty("width", basis, "important");
        row.slot.style.setProperty("max-width", basis, "important");
      });
    }
    ranked.forEach((row, index) => {
      row.slot.style.setProperty("order", String(index + 1), "important");
      row.slot.setAttribute("data-allegro-order", "1");
      if (row.percent > 0) row.card.setAttribute("data-allegro-przecena", "−" + row.percent + "%");
      else row.card.removeAttribute("data-allegro-przecena");
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
        clearMarks();
        return publish({ enabled: false, total: 0, marked: 0, max: 0 });
      }
      let marked = 0;
      let max = 0;
      let total = 0;
      groupsOf(collectCards()).forEach((group) => {
        const ranked = group.pairs
          .map((pair, index) => ({
            slot: pair.slot,
            card: pair.card,
            index: index,
            percent: filter.discountFromText(pair.card.innerText || ""),
          }))
          .sort((a, b) => b.percent - a.percent || a.index - b.index);
        layout(group, ranked);
        ranked.forEach((row) => {
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
    scanTimer = window.setTimeout(apply, 180);
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
    }, 500);
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
