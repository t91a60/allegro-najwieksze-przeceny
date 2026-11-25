(function () {
  "use strict";

  const onButton = document.getElementById("on");
  const offButton = document.getElementById("off");
  const stat = document.getElementById("stat");

  function paint(on) {
    onButton.setAttribute("aria-pressed", on ? "true" : "false");
    offButton.setAttribute("aria-pressed", on ? "false" : "true");
  }

  function send(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response || null);
      });
    });
  }

  function describe(info) {
    if (!info) {
      stat.textContent = "Otwórz allegro.pl. Jeśli wtyczka jest świeżo dodana, odśwież kartę.";
      return;
    }
    if (!info.enabled) {
      stat.textContent = info.total
        ? "Wyłączone. " + info.total + " ofert zostaje w kolejności Allegro."
        : "Wyłączone. Kolejność Allegro.";
      return;
    }
    if (!info.total) {
      stat.textContent = "Włączone. Na tej stronie nie widać jeszcze listy ofert.";
      return;
    }
    stat.textContent = info.marked
      ? "Włączone. Ułożone " + info.total + " ofert, największa przecena −" + info.max + "%."
      : "Włączone. Widzę " + info.total + " ofert, ale żadna nie ma oznaczonej obniżki.";
  }

  async function ask(tabId) {
    let info = await send(tabId, { type: "GET_STATE" });
    if (info) return info;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["filter.js", "content.js"],
      });
    } catch (error) {
      return null;
    }
    return send(tabId, { type: "GET_STATE" });
  }

  async function currentTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function refresh() {
    const tab = await currentTab();
    if (!tab || !tab.id || !tab.url || !/^https?:\/\/([^/]+\.)?allegro\.pl(?:\/|$)/.test(tab.url)) {
      describe(null);
      return;
    }
    describe(await ask(tab.id));
  }

  async function setEnabled(on) {
    paint(on);
    await chrome.storage.local.set({ enabled: on });
    const tab = await currentTab();
    if (!tab || !tab.id) {
      describe(null);
      return;
    }
    const info = (await send(tab.id, { type: "SET_ENABLED", enabled: on })) || (await ask(tab.id));
    describe(info);
  }

  onButton.addEventListener("click", () => setEnabled(true));
  offButton.addEventListener("click", () => setEnabled(false));

  chrome.storage.local.get({ enabled: true }, (data) => {
    paint(data.enabled !== false);
    refresh();
  });
})();
