# Allegro: największe przeceny

Wtyczka Chrome (Manifest V3). Na liście ofert Allegro układa kafelki od **największej przeceny**, a nie według „Top”.

Działa na [Black Friday](https://allegro.pl/strefaokazji/black-friday?tag=top-hits) i na zwykłych listingach `allegro.pl`. Bierze pod uwagę tylko oferty już widoczne na stronie (Allegro nie oddaje całej wyprzedaży w jednym ładowaniu).

Procent jest brany z plakietki `−NN%` / Okazja. Gdy jej nie ma, liczony jest z ceny aktualnej i przekreślonej. Pomijane są dostawa, raty, cashback i hasła typu „do 50%”.

## Instalacja

1. Pobierz ZIP albo sklonuj repozytorium.
2. Rozpakuj.
3. Wejdź na `chrome://extensions/`.
4. Włącz tryb dewelopera i kliknij **Załaduj rozpakowane**.
5. Wskaż folder z `manifest.json`, potem odśwież Allegro.

Na stronie jest pigułka „Przecena: włączona”. Kliknięcie wyłącza sortowanie. Ten sam przełącznik jest w ikonie wtyczki.
