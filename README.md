# Open Triage

Lokalny, interaktywny prototyp wspólnej skrzynki wsparcia. Next.js 16, React 19, TypeScript i Tailwind CSS 4.

**Aktualny stan:** `test@sellersk.it` odbiera prawdziwe wiadomości przez IMAP i wysyła odpowiedzi przez SMTP. Kopia odpowiedzi trafia do folderu „Wysłane” tej samej skrzynki. Serwer sprawdza INBOX przy uruchomieniu i co 30 sekund; panel odświeża dane co 2 sekundy. Wiadomości demonstracyjne zostały usunięte.

## Uruchomienie

Wymagany Node.js 20.9 lub nowszy (zalecana wersja LTS).

```sh
npm install
npm run dev
```

Otwórz [lokalne demo](http://127.0.0.1:3000/prototype/support?variant=inbox).

Panel jest dostępny tylko na lokalnym komputerze. Uruchamiaj jeden proces serwera dla tego katalogu danych. Nie uruchamiaj jednocześnie `npm run dev` i `npm start` na tych samych danych.

Połączenie pocztowe korzysta z `.env.local` (poza Gitem, tylko po stronie serwera). W nowej kopii projektu skopiuj `.env.example` do `.env.local` i uzupełnij hasło. Skonfigurowana skrzynka to `test@sellersk.it`, serwer `serwer1948395.home.pl`, port `993`, z weryfikowanym TLS. Dane logowania nie trafiają do przeglądarki ani do `state.json`.

SMTP używa tego samego serwera na porcie `465` z TLS. `TRIAGE_SMTP_PASSWORD` może pozostać puste, aby użyć hasła IMAP tej samej skrzynki. `TRIAGE_IMAP_SENT_FOLDER=SENT` wskazuje folder wysłanych home.pl; bez tej zmiennej aplikacja szuka folderu oznaczonego przez serwer jako `\Sent`.

Na pasku skrzynki widać stan IMAP i czas ostatniego udanego sprawdzenia. „Sprawdź pocztę” pobiera nowe maile od razu. Automatyczny odbiór działa, kiedy uruchomiony jest lokalny serwer, również po zamknięciu kart przeglądarki. Skrzynka jest otwierana do odczytu: aplikacja nie usuwa wiadomości z serwera ani nie zmienia flag przeczytania.

Odpowiedź ma wspólne `From` i `Reply-To`: `test@sellersk.it`. Pracownik jest zapisany jako autor w panelu. `Message-ID`, `In-Reply-To` i `References` wiążą odpowiedź z wątkiem także w innych klientach pocztowych. Po przyjęciu przez SMTP identyczna wiadomość MIME jest zapisywana przez IMAP do „Wysłanych”. Nie trzeba dodawać własnego adresu do DW. Komentarze wewnętrzne nie są dodawane do wysyłki ani kopii.

Przy `npm run dev` działa [React Grab](https://github.com/aidenybai/react-grab), ładowany z lokalnego pakietu. Najedź kursorem na element interfejsu, naciśnij `⌘C` (Windows/Linux: `Ctrl+C`) i wklej skopiowany kontekst do rozmowy. Narzędzie dołącza komponent i położenie w kodzie. W buildzie produkcyjnym jest wyłączone.

```sh
npm run typecheck
npm run build
npm start
```

## Co można sprawdzić

- Trzy warianty: [skrzynka](http://127.0.0.1:3000/prototype/support?variant=inbox), [kolejka](http://127.0.0.1:3000/prototype/support?variant=queue), [tablica](http://127.0.0.1:3000/prototype/support?variant=board). Układy przełącza się zakładkami w zwartym pasku nad rozmowami. W trybie developerskim działają także strzałki klawiatury poza polami edycji.
- Trzy skrzynki: `info@panelpro.pl`, `info@sellersk.it` i `test@sellersk.it`. IMAP i SMTP działają dla ostatniej; dwie pozostałe czekają na podłączenie.
- Zespół: Tomasz Dłuski, Mateusz Gołębiowski i Irena Bronkowska-Mika. Wybór pracownika oraz nowe przypisania obejmują wyłącznie te trzy osoby.
- Przypisywanie rozmów, priorytety, kategorie, statusy, wyszukiwanie i filtry.
- Treść maila zajmuje główną część panelu. Podpowiedź AI i pusty edytor są domyślnie zwinięte. Zapisany szkic otwiera edytor; ręczne zwinięcie zachowuje tekst.
- Osobne szkice odpowiedzi i komentarzy dla każdego pracownika. Szkice zapisują się po 450 ms bez pisania i przed wysłaniem. Wskaźnik pod edytorem potwierdza zapis.
- Podpisy Ireny, Mateusza i Tomasza są widoczne pod edytorem odpowiedzi. Wysyłka utrwala podpis autora i tworzy równolegle bezpieczną wersję tekstową oraz HTML; podpis nie jest częścią szkicu ani komentarza wewnętrznego.
- HTML wiadomości i stopki jest kompilowany lokalnie przez MJML (`src/lib/mail-template.ts`), z walidacją szablonu, responsywnymi kolumnami i obsługą Outlooka. Pełny dokument wraz ze stylami trafia do części HTML MIME; zwykły tekst pozostaje alternatywą. Kompilator działa tylko na serwerze, bez zewnętrznego API ani pobierania fontów.
- Ustawienia → Podpisy pracowników: wybierz osobę, edytuj pełny MJML, odśwież podgląd i zapisz. Treść odpowiedzi jest dodawana nad podpisem; alternatywa tekstowa powstaje z szablonu. Zapis jest lokalny i sprawdza wersję, aby uniknąć nadpisania równoległych zmian. Zmiany podpisu nie modyfikują już przygotowanych ani wysłanych wiadomości.
- Komentarze wewnętrzne z linkami przewijającymi do konkretnego wpisu. Linki są lokalne, nie udostępniają panelu przez Internet.
- Propozycje odpowiedzi przez OpenRouter, ze źródłami z zatwierdzonej wiedzy tej samej skrzynki. Wybór modelu i zapis klucza w Ustawieniach.
- Akceptacja, odrzucanie i edycja dokumentów z historią wersji. Zakończenie rozmowy tworzy archiwum oraz propozycję wiedzy do zatwierdzenia.
- Powiadomienia w panelu i podglądy Google Chat / Discord, bez wysyłki.

## OpenRouter

W [Ustawieniach](http://127.0.0.1:3000/prototype/support?view=settings) wklej klucz OpenRouter, wybierz model i zapisz. Domyślny model nowej instalacji to `z-ai/glm-5.3`; lista pochodzi z publicznego katalogu OpenRouter i obejmuje modele obsługujące strukturalne odpowiedzi JSON. „Sprawdź połączenie” weryfikuje klucz oraz obecność modelu w katalogu, bez płatnego generowania. Dostęp dostawcy i saldo są ostatecznie weryfikowane podczas generowania.

Sekcja „Koszty AI” pokazuje w USD koszt żądań rozliczonych przez ten panel, liczbę żądań i tokenów oraz łączne użycie i pozostały limit aktualnego klucza zwracane przez OpenRouter. Lokalny rejestr kosztów jest trwały w `state.json` i obejmuje także odpowiedzi odrzucone po generowaniu; ponowne wyświetlenie zapisanej propozycji nie nalicza żądania drugi raz. Dane klucza mogą obejmować użycie poza panelem. Pozostały limit dotyczy budżetu klucza i nie jest przedstawiany jako saldo całego konta.

Klucz jest wspólny dla zespołu, zapisany atomowo w `data/prototype/settings/openrouter.json` z uprawnieniami `0600`, poza Gitem. Nie trafia do publicznego API, `state.json` ani pamięci przeglądarki. Puste pole zachowuje zapisany klucz; „Usuń klucz” wyłącza generowanie. Zmiany ustawień mają kontrolę wersji, aby inna karta nie nadpisała ich przypadkowo.

W rozmowie kliknij „Generuj propozycję”. Model otrzymuje temat, adresy, ostatnie 12 publicznych wiadomości (do 6000 znaków każda) i do 8 zatwierdzonych dokumentów tej samej skrzynki (do 8000 znaków każdy), wybranych według zgodności słów z pytaniem. Maile klienta są przekazywane jako nieufna treść użytkownika, a zatwierdzone dokumenty jako wiążąca wiedza systemowa. Jeśli istnieje trafny dokument, kontrakt odpowiedzi wymaga niepustego tekstu i co najmniej jednego prawidłowego źródła. Komentarze, szkice, aktywności i niezatwierdzona wiedza nie są przekazywane. Generowanie rozlicza OpenRouter według wybranego modelu.

Prompt jest ułożony pod cache: stałe instrukcje, wybrane dokumenty w stabilnej kolejności, a na końcu zmienna rozmowa. `session_id` wspólny dla skrzynki pomaga OpenRouter kierować żądania do tego samego dostawcy. Cache zależy od modelu i dostawcy; panel nie raportuje jeszcze liczby trafień. Selekcja wiedzy jest lokalna i oparta na słowach — nie korzysta z drugiego modelu ani embeddingów.

Wynik zawiera propozycję odpowiedzi, źródła i propozycję kategorii oraz priorytetu. „Użyj propozycji” przenosi tekst do własnego szkicu; wysłanie maila pozostaje osobną akcją. Brak udokumentowanego rozwiązania skutkuje eskalacją do człowieka i powiadomieniem w panelu. Błędne źródła lub niepełny JSON są odrzucane.

Wynik jest zapisany przy rozmowie i dostępny dla zespołu po restarcie. Równoległe generowanie dla tego samego kontekstu współdzieli jedną operację. „Wygeneruj ponownie” świadomie zamawia kolejną odpowiedź. Zmiana publicznej rozmowy, wiedzy lub ustawień podczas generowania odrzuca nieaktualny wynik; edytowane szkice pozostają nietknięte. Zmiany po wygenerowaniu blokują użycie starej propozycji.

## Współpraca w kilku kartach

Przypisania, szkice, komentarze i obecność działają również na prawdziwych rozmowach pobranych z IMAP.

1. Otwórz tę samą rozmowę w dwóch kartach lub oknach.
2. Wybierz innego pracownika w dolnej części menu w każdej karcie. Wybór jest zapisany w `sessionStorage`, osobno dla karty.
3. Przydziel sprawę, dodaj komentarz albo przygotuj szkic. Dane odświeżają się co dwie sekundy.
4. Gdy wpłynie kolejna wiadomość lub ktoś odpowie w wątku, pracownik zachowuje swój szkic i widzi ostrzeżenie. Musi przejrzeć aktualny wątek przed wysłaniem nowej odpowiedzi.

Obecność jest sygnalizowana z widocznego okna, odświeżana co 15 sekund i wygasa po 45 sekundach. Ukryte lub zamknięte karty przestają sygnalizować obecność. Zmieniona odpowiedź i dokument są kontrolowane ponownie na serwerze, niezależnie od ostrzeżeń w interfejsie. Identyfikator operacji chroni przed powtórzeniem tej samej wysyłki lub komentarza.

Przypisanie wskazuje osobę odpowiedzialną, ale nie blokuje innym odpowiadania. Tożsamości są symulowane; demo nie implementuje uwierzytelniania ani rzeczywistych uprawnień.

## Dane na dysku

```text
data/prototype/
  state.json
  settings/openrouter.json  # prywatny klucz i model, uprawnienia 0600
  mail/test/<uid-validity>/<uid>.eml
  generations/<generation-id>/
    knowledge/<mailbox-id>/<document-id>/v1.md
    knowledge/<mailbox-id>/<document-id>/v2.md
    archives/<mailbox-id>/<conversation-id>-v1.md
```

`state.json` jest źródłem stanu aplikacji. Operacje są wykonywane kolejno w jednym procesie, a pliki podmieniane atomowo. Wersje Markdown powstają przed potwierdzeniem zmiany. Uruchomienie API odtwarza kopie Markdown ze stanu, jeśli ich brakuje. Obecność jest ulotna i resetuje się po restarcie.

Import dopisuje wiadomości i zapisuje kursor IMAP w tej samej kolejce, zachowując zmiany zespołu. Identyfikatory UID/UIDVALIDITY i Message-ID chronią przed duplikatami po ponowieniu lub restarcie. References/In-Reply-To łączą odpowiedzi z istniejącymi rozmowami w tej samej skrzynce; identyczny temat sam w sobie nie łączy spraw. Nowa wiadomość otwiera ponownie zakończoną rozmowę. Oryginały MIME, łącznie z załącznikami, można pobrać jako `.eml` z osi rozmowy. Panel pokazuje treść tekstową (HTML jest konwertowany do tekstu), bez uruchamiania skryptów lub pobierania obrazów śledzących z maila.

Wysyłki mają trwały dziennik `outbox` w `state.json` z identyfikatorem operacji i oryginalnym MIME. Nie jest on zwracany w publicznym stanie panelu. Rezerwacja sprawdza rewizję rozmowy i szkicu, a sieciowe operacje SMTP/IMAP odbywają się poza kolejką zapisów, więc nie blokują komentarzy i pozostałych rozmów. Nowszy szkic lub mail odebrany w trakcie wysyłki nie jest nadpisywany.

Po przyjęciu odpowiedzi przez SMTP błąd IMAP ponawia tylko zapis kopii, co 30 sekund. Przed powtórzeniem APPEND sprawdzany jest Message-ID w „Wysłanych”, także przez odczyt nagłówków FETCH, gdy home.pl nie zwraca istniejącej wiadomości w SEARCH HEADER. Przy utracie potwierdzenia SMTP albo przerwaniu procesu podczas wysyłki panel oznacza wynik jako niepewny i blokuje kolejne wysyłki w tej rozmowie do wyjaśnienia. Samo SMTP nie gwarantuje dokładnie jednej dostawy po zerwaniu połączenia; aplikacja nie zgaduje wyniku i nie wysyła automatycznie drugi raz.

Generator wiadomości oraz przycisk i operacja przywracania demo zostały usunięte. Pierwsze uruchomienie tworzy wyłącznie konfigurację skrzynek i zespołu. Katalog danych jest wyłączony z Git.

Migracja wersji 4 usuwa rozpoznane rozmowy przykładowe z `test@sellersk.it` oraz powiązane szkice, powiadomienia, archiwa i wiedzę demonstracyjną. Ręcznie dodane dokumenty oraz rozmowy spoza zestawu przykładowego pozostają. Kopia poprzedniego stanu w `data/prototype/backups/` i historyczne pliki Markdown nie są wczytywane do panelu.

Zmiana zespołu również zapisuje kopię JSON. Poprzednie profile demo stają się nieaktywne, ale zachowują autorstwo wpisów, wcześniejsze przypisania i szkice. Przypisanie do dawnego profilu można przekazać jednej z trzech osób z aktualnego zespołu. Karta z wybranym dawnym profilem przechodzi na Tomasza.

Wiadomości publiczne oraz komentarze mają rozdzielone typy i operacje. Archiwum oznacza komentarze jako wewnętrzne; propozycje odpowiedzi i wiedzy nie korzystają z ich treści.

## Granice prototypu

Podłączone są IMAP i SMTP skrzynki testowej oraz OpenRouter po zapisaniu klucza w ustawieniach. Supabase i GitHub nie są podłączone. Nowe sprawy otrzymują kategorię „Inne” i normalny priorytet; generowanie AI proponuje klasyfikację do zatwierdzenia przez pracownika. Nie ma automatycznego generowania przy odbiorze maila. Propozycja wpisu do wiedzy przy zakończeniu rozmowy powstaje lokalnie z publicznej odpowiedzi i wymaga zatwierdzenia. Foldery inne niż INBOX nie są importowane, ale odpowiedzi z panelu są zapisywane do „Wysłanych”. Załączniki odebrane są dostępne w `.eml`; edytor wysyła odpowiedzi tekstowe.

## Weryfikacja

Testy (Node.js 22.18+): `npm test`. Obejmują import, deduplikację, wątki, izolację skrzynek, szkice, komentarze i MIME, a także wspólnego nadawcę, potwierdzenie SMTP, oddzielne ponawianie kopii, przerwane połączenia, konflikty i identyczną treść kopii w „Wysłanych”. Testy wysyłki korzystają z podstawionych transportów; nie wysyłają maili do klientów. Logowanie SMTP i folder `SENT` sprawdzono na koncie testowym bez wysyłania wiadomości.

Po ręcznej wysyłce z panelu sprawdzono także prawdziwą kopię w `SENT`: jeden Message-ID, identyczny MIME oraz wspólne adresy From/Reply-To. Sprawdzenie ponownego zapisu wykonało odczyt istniejącej kopii bez APPEND i bez kolejnego SMTP.

Przeprowadzono build, kontrolę typów oraz sprawdzenie przez lokalne API: 10 równoległych komentarzy, niezależne szkice, konflikt równoległych odpowiedzi, ponowienie tej samej operacji, poprawnego nadawcę, izolację komentarzy, archiwum i wersjonowanie wiedzy. Przepływy edytora, komentarzy i linków sprawdzono także w przeglądarce.

Testy AI używają fikcyjnego transportu i tymczasowego katalogu danych. Sprawdzają prywatny zapis klucza i restart, konflikty ustawień, izolację wiedzy i komentarzy, walidację źródeł, wymuszenie użycia trafnej wiedzy, obsługę błędów API, zapis propozycji, wspólne generowanie w kilku kartach, eskalację oraz odrzucenie wyniku po zmianie rozmowy, wiedzy lub ustawień. Testy podpisów sprawdzają dane wszystkich pracowników, utrwalenie podpisu autora, kodowanie HTML oraz oba warianty MIME.
