# Open Triage

Lokalny, interaktywny prototyp wspólnej skrzynki wsparcia. Next.js 16, React 19, TypeScript i Tailwind CSS 4.

**Aktualny stan:** `support@example.com` odbiera prawdziwe wiadomości przez IMAP. Serwer sprawdza INBOX przy uruchomieniu i co 30 sekund; panel odświeża dane co 2 sekundy. Wiadomości demonstracyjne zostały usunięte. Wysyłanie SMTP nie jest jeszcze podłączone.

## Uruchomienie

Wymagany Node.js 20.9 lub nowszy (zalecana wersja LTS).

```sh
npm install
npm run dev
```

Otwórz [lokalne demo](http://127.0.0.1:3000/prototype/support?variant=inbox).

Panel jest dostępny tylko na lokalnym komputerze. Uruchamiaj jeden proces serwera dla tego katalogu danych. Nie uruchamiaj jednocześnie `npm run dev` i `npm start` na tych samych danych.

Połączenie pocztowe korzysta z `.env.local` (poza Gitem, tylko po stronie serwera). W nowej kopii projektu skopiuj `.env.example` do `.env.local` i uzupełnij hasło. Skonfigurowana skrzynka to `support@example.com`, serwer `mail.example.com`, port `993`, z weryfikowanym TLS. Dane logowania nie trafiają do przeglądarki ani do `state.json`.

Na pasku skrzynki widać stan IMAP i czas ostatniego udanego sprawdzenia. „Sprawdź pocztę” pobiera nowe maile od razu. Automatyczny odbiór działa, kiedy uruchomiony jest lokalny serwer, również po zamknięciu kart przeglądarki. Skrzynka jest otwierana do odczytu: aplikacja nie usuwa wiadomości z serwera ani nie zmienia flag przeczytania.

Przy `npm run dev` działa [React Grab](https://github.com/aidenybai/react-grab), ładowany z lokalnego pakietu. Najedź kursorem na element interfejsu, naciśnij `⌘C` (Windows/Linux: `Ctrl+C`) i wklej skopiowany kontekst do rozmowy. Narzędzie dołącza komponent i położenie w kodzie. W buildzie produkcyjnym jest wyłączone.

```sh
npm run typecheck
npm run build
npm start
```

## Co można sprawdzić

- Trzy warianty: [skrzynka](http://127.0.0.1:3000/prototype/support?variant=inbox), [kolejka](http://127.0.0.1:3000/prototype/support?variant=queue), [tablica](http://127.0.0.1:3000/prototype/support?variant=board). Układy przełącza się zakładkami w zwartym pasku nad rozmowami. W trybie developerskim działają także strzałki klawiatury poza polami edycji.
- Trzy skrzynki: `hello@opentriage.com`, `hello@opentriage.com` i `support@example.com`. Odbiór IMAP działa dla ostatniej; dwie pozostałe czekają na podłączenie.
- Zespół: Michał Kluska, Jan Kowalski i Anna Nowak. Wybór pracownika oraz nowe przypisania obejmują wyłącznie te trzy osoby.
- Przypisywanie rozmów, priorytety, kategorie, statusy, wyszukiwanie i filtry.
- Treść maila zajmuje główną część panelu. Podpowiedź AI i pusty edytor są domyślnie zwinięte. Zapisany szkic otwiera edytor; ręczne zwinięcie zachowuje tekst.
- Osobne szkice odpowiedzi i komentarzy dla każdego pracownika. Szkice zapisują się po 450 ms bez pisania i przed wysłaniem. Wskaźnik pod edytorem potwierdza zapis.
- Komentarze wewnętrzne z linkami przewijającymi do konkretnego wpisu. Linki są lokalne, nie udostępniają panelu przez Internet.
- Propozycje odpowiedzi z zatwierdzonej wiedzy tej samej skrzynki. To deterministyczne scenariusze, bez modelu AI.
- Akceptacja, odrzucanie i edycja dokumentów z historią wersji. Zakończenie rozmowy tworzy archiwum oraz propozycję wiedzy do zatwierdzenia.
- Powiadomienia w panelu i podglądy Google Chat / Discord, bez wysyłki.

## Współpraca w kilku kartach

Przypisania, szkice, komentarze i obecność działają również na prawdziwych rozmowach pobranych z IMAP.

1. Otwórz tę samą rozmowę w dwóch kartach lub oknach.
2. Wybierz innego pracownika w dolnej części menu w każdej karcie. Wybór jest zapisany w `sessionStorage`, osobno dla karty.
3. Przydziel sprawę, dodaj komentarz albo przygotuj szkic. Dane odświeżają się co dwie sekundy.
4. Gdy wpłynie kolejna wiadomość w wątku, pracownik zachowuje swój szkic i widzi ostrzeżenie o nowej wiadomości. Odpowiedzi SMTP pozostają zablokowane; można zapisywać szkice i komentarze.

Obecność jest sygnalizowana z widocznego okna, odświeżana co 15 sekund i wygasa po 45 sekundach. Ukryte lub zamknięte karty przestają sygnalizować obecność. Zmieniona odpowiedź i dokument są kontrolowane ponownie na serwerze, niezależnie od ostrzeżeń w interfejsie. Identyfikator operacji chroni przed powtórzeniem tej samej wysyłki lub komentarza.

Przypisanie wskazuje osobę odpowiedzialną, ale nie blokuje innym odpowiadania. Tożsamości są symulowane; demo nie implementuje uwierzytelniania ani rzeczywistych uprawnień.

## Dane na dysku

```text
data/prototype/
  state.json
  mail/test/<uid-validity>/<uid>.eml
  generations/<generation-id>/
    knowledge/<mailbox-id>/<document-id>/v1.md
    knowledge/<mailbox-id>/<document-id>/v2.md
    archives/<mailbox-id>/<conversation-id>-v1.md
```

`state.json` jest źródłem stanu aplikacji. Operacje są wykonywane kolejno w jednym procesie, a pliki podmieniane atomowo. Wersje Markdown powstają przed potwierdzeniem zmiany. Uruchomienie API odtwarza kopie Markdown ze stanu, jeśli ich brakuje. Obecność jest ulotna i resetuje się po restarcie.

Import dopisuje wiadomości i zapisuje kursor IMAP w tej samej kolejce, zachowując zmiany zespołu. Identyfikatory UID/UIDVALIDITY i Message-ID chronią przed duplikatami po ponowieniu lub restarcie. References/In-Reply-To łączą odpowiedzi z istniejącymi rozmowami w tej samej skrzynce; identyczny temat sam w sobie nie łączy spraw. Nowa wiadomość otwiera ponownie zakończoną rozmowę. Oryginały MIME, łącznie z załącznikami, można pobrać jako `.eml` z osi rozmowy. Panel pokazuje treść tekstową (HTML jest konwertowany do tekstu), bez uruchamiania skryptów lub pobierania obrazów śledzących z maila.

Generator wiadomości oraz przycisk i operacja przywracania demo zostały usunięte. Pierwsze uruchomienie tworzy wyłącznie konfigurację skrzynek i zespołu. Katalog danych jest wyłączony z Git.

Migracja wersji 4 usuwa rozpoznane rozmowy przykładowe z `support@example.com` oraz powiązane szkice, powiadomienia, archiwa i wiedzę demonstracyjną. Ręcznie dodane dokumenty oraz rozmowy spoza zestawu przykładowego pozostają. Kopia poprzedniego stanu w `data/prototype/backups/` i historyczne pliki Markdown nie są wczytywane do panelu.

Zmiana zespołu również zapisuje kopię JSON. Poprzednie profile demo stają się nieaktywne, ale zachowują autorstwo wpisów, wcześniejsze przypisania i szkice. Przypisanie do dawnego profilu można przekazać jednej z trzech osób z aktualnego zespołu. Karta z wybranym dawnym profilem przechodzi na Michała.

Wiadomości publiczne oraz komentarze mają rozdzielone typy i operacje. Archiwum oznacza komentarze jako wewnętrzne; propozycje odpowiedzi i wiedzy nie korzystają z ich treści.

## Granice prototypu

Podłączony jest odbiór INBOX przez IMAP, bez SMTP, OpenRouter, Supabase ani GitHuba. Wysyłanie jest zablokowane dla wszystkich obecnych skrzynek. Nowe sprawy otrzymują kategorię „Inne” i normalny priorytet do ręcznego triage; model AI nie jest podłączony. Foldery inne niż INBOX nie są importowane. Załączniki są dostępne w oryginalnym pliku `.eml`.

## Weryfikacja

Testy importu (Node.js 22.18+): `node --test tests/mail-import.test.mjs`. Sprawdzają deduplikację, zmianę UIDVALIDITY, łączenie odpowiedzi, izolację skrzynek, zachowanie komentarzy i szkiców oraz dekodowanie polskiego MIME z HTML i załącznikiem.

Przeprowadzono build, kontrolę typów oraz sprawdzenie przez lokalne API: 10 równoległych komentarzy, niezależne szkice, konflikt równoległych odpowiedzi, ponowienie tej samej operacji, poprawnego nadawcę, izolację komentarzy, archiwum i wersjonowanie wiedzy. Przepływy edytora, komentarzy i linków sprawdzono także w przeglądarce.
