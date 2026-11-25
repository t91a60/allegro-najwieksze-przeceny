/* Wylicza procent przeceny z tekstu karty Allegro. Bez API Chrome. */
(function (root) {
  "use strict";

  function fold(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/ł/g, "l")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function parsePriceToken(whole, fraction) {
    const digits = String(whole || "").replace(/[ \u00a0.]/g, "");
    if (!/^\d+$/.test(digits)) return null;
    const value = Number(digits) + (fraction ? Number(fraction) / 100 : 0);
    if (!Number.isFinite(value) || value < 1 || value > 1000000) return null;
    return value;
  }

  function lineIsNoise(line) {
    return /dostaw|przesyl|wysyl|z dostawa|raty|\/mc|\/mies|cashback|zwrot|kupon|klik|punkt|smart!?$|rrso|prowiz|w zestawie z dostawa/.test(
      fold(line),
    );
  }

  function discountFromText(text) {
    const lines = String(text || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const percents = [];
    const prices = [];

    lines.forEach((line) => {
      if (lineIsNoise(line)) return;
      const folded = fold(line);
      const isCeiling = /\b(do|nawet|az|max|maksymalnie)\s+\d{1,2}\s*%/.test(folded);
      const badge = line.match(/[-−–]\s*(\d{1,2})\s*%/);
      if (badge && !isCeiling) {
        const value = Number(badge[1]);
        if (value >= 1 && value <= 90) percents.push(value);
      } else if (/^(\d{1,2})\s*%$/.test(line)) {
        const value = Number(line.match(/^(\d{1,2})/)[1]);
        if (value >= 5 && value <= 90) percents.push(value);
      }

      if (isCeiling) return;
      const priceRe = /(\d{1,3}(?:[ \u00a0]\d{3})+|\d{1,6})(?:,(\d{2}))?\s*zł/gi;
      let match = priceRe.exec(line);
      while (match) {
        const price = parsePriceToken(match[1], match[2]);
        if (price !== null) prices.push(price);
        match = priceRe.exec(line);
      }
    });

    if (percents.length) return Math.max.apply(null, percents);
    if (prices.length >= 2) {
      const current = Math.min.apply(null, prices);
      const previous = Math.max.apply(null, prices);
      if (previous > current) {
        const percent = Math.round((1 - current / previous) * 100);
        if (percent >= 5 && percent <= 90) return percent;
      }
    }
    return 0;
  }

  root.AllegroPrzecena = { discountFromText: discountFromText, fold: fold };
})(typeof globalThis !== "undefined" ? globalThis : this);
