(function () {
  "use strict";

  const toggle = document.getElementById("toggle");
  const state = document.getElementById("state");
  const stat = document.getElementById("stat");

  function paint(on) {
    toggle.setAttribute("aria-checked", on ? "true" : "false");
    state.textContent = on ? "Włączone" : "Wyłączone";
  }

  function send(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response || null);
      });
    });
  }

  async function tab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function describe(info) {
    if (!info) {
      stat.textContent = "Otwórz allegro.pl i odśwież kartę, jeśli wtyczka jest świeżo dodana.";
      return;
    }
    if (!info.total) {
      stat.textContent = "Na tej stronie nie widać listy ofert.";
      return;
    }
    if (!info.enabled) {
      stat.textContent = info.total + " ofert zostaje w kolejności Allegro.";
      return;
    }
    stat.textContent = info.marked
      ? "Posortowano " + info.total + " ofert. Największa przecena: −" + info.max + "%."
      : "Widzę " + info.total + " ofert, ale żadna nie ma oznaczonej obniżki.";
  }

  async function refresh() {
    const current = await tab();
    if (!current || !current.id) {
      describe(null);
      return;
    }
    describe(await send(current.id, { type: "GET_STATE" }));
  }

  toggle.addEventListener("click", async () => {
    const next = toggle.getAttribute("aria-checked") !== "true";
    paint(next);
    await chrome.storage.local.set({ enabled: next });
    await refresh();
  });

  chrome.storage.local.get({ enabled: true }, (data) => {
    paint(data.enabled !== false);
    refresh();
  });
})();
