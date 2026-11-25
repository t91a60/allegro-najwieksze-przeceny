chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "BADGE" || !sender.tab || !sender.tab.id) return;
  const text = message.text ? String(message.text).slice(0, 4) : "";
  chrome.action.setBadgeText({ tabId: sender.tab.id, text: text });
  chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#ff5a00" });
  chrome.action.setTitle({
    tabId: sender.tab.id,
    title: text ? "Największa przecena na stronie: −" + text + "%" : "Największe przeceny Allegro",
  });
});
