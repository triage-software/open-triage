# Plan uprodukcyjnienia: PostgreSQL, S3 i stateless aplikacja

**Status: roboczy — do dalszego dopracowania.**

Data zapisu: 2026-09-04. Opis stanu obecnego opiera się na przeglądzie kodu z 2026-09-03, przy rewizji `eb4b235`.

Dokument zapisuje kierunek uzgodniony podczas rozmowy. Nie oznacza gotowości do produkcji ani zgody na implementację migracji lub wdrożenie. Na razie dopracowujemy aplikację lokalnie; migracja i produkcja wymagają osobnej decyzji. Zapisanie tego dokumentu na `main` nie uruchamia żadnego z opisanych działań.

## 1. Jak dane są przechowywane dzisiaj

Obecnie to lokalny magazyn plikowy, przeznaczony dla jednego procesu, nie baza danych.

| Dane | Obecne miejsce | Docelowe miejsce |
| --- | --- | --- |
| Rozmowy, treści maili, komentarze, przypisania, szkice, powiadomienia, podpisy | `data/prototype/state.json` | Tabele PostgreSQL |
| Wiedza z historią wersji i archiwa rozmów | `state.json` oraz kopie `.md` | PostgreSQL; Markdown jako eksport |
| Oryginały odebranych maili z załącznikami | Pliki `.eml` | Prywatny bucket S3 |
| Oryginały wysłanych maili | Base64 wewnątrz `outbox` w JSON | S3; odnośnik w PostgreSQL |
| Kursor IMAP, dziennik wysyłek, idempotencja, wyniki i koszty AI | `state.json` | PostgreSQL |
| Model i klucz OpenRouter | Osobny `data/prototype/settings/openrouter.json` | PostgreSQL, klucz zaszyfrowany |
| Obecność pracowników i koordynacja operacji | Pamięć procesu | PostgreSQL |
| Wybrany pracownik | `sessionStorage` przeglądarki, bez logowania | Tożsamość Google i sesja w PostgreSQL |

Każda operacja odczytuje cały JSON, a zmiana zapisuje cały plik przez plik tymczasowy i `rename`. Kolejka w pamięci szereguje operacje wyłącznie w jednym procesie. Markdown jest kopią danych, nie niezależnym źródłem prawdy. Samo zastąpienie pliku jedną kolumną JSONB nie rozwiązuje problemu wielu replik.

Źródła w repozytorium: [magazyn stanu](../src/lib/store.ts), [zapis MIME i synchronizacja](../src/lib/mail-sync.ts), [ustawienia AI](../src/lib/ai-settings-store.ts).

## 2. Docelowy podział odpowiedzialności

PostgreSQL będzie źródłem prawdy dla aplikacji. S3 będzie magazynem oryginalnych wiadomości. Pod aplikacji nie będzie posiadał trwałego stanu; PostgreSQL i magazyn obiektowy pozostają usługami stanowymi.

- Osobne rekordy dla rozmów, wiadomości, komentarzy, szkiców, wersji wiedzy, archiwów, powiadomień, operacji i ustawień. Treści tekstowe zostają w bazie; JSONB tylko dla złożonych snapshotów, np. podpisu utrwalonego przy wysyłce i źródeł AI.
- Wiedza i archiwa pozostają w PostgreSQL jako wersjonowany tekst. Nie utrzymujemy dodatkowych kopii `.md` na dysku ani w S3; eksport powstaje na żądanie.
- S3 przechowuje niezmienne MIME przychodzące i wychodzące. Załączników nie wydzielamy w tej iteracji — już są częścią MIME.
- Baza przechowuje klucz obiektu, rozmiar i SHA-256. Bucket jest prywatny; pobranie przechodzi przez uwierzytelnione API.
- Import: najpierw zapis MIME do S3, następnie jedna transakcja zapisująca wiadomość i kursor IMAP. Awaria bazy może pozostawić nieużywany obiekt, ale nie potwierdzimy importu bez oryginału.
- Warstwa dostępu: `pg` i wersjonowane migracje SQL; klient S3 przez AWS SDK z konfigurowalnym endpointem. Bez zależności aplikacyjnej od AWS ani Kubernetes.

## 3. Stateless i koordynacja niezależna od K8s

Jeden obraz aplikacji, dwa niezależne tryby uruchomienia:

- **Web:** Next.js, UI, uwierzytelnienie i API.
- **Worker:** synchronizacja IMAP, wysyłki SMTP, ponawianie kopii „Wysłane” i generowanie AI.

Worker będzie zwykłym procesem Node, uruchamialnym również w Docker Compose lub poza kontenerem. Usuwamy uruchamianie synchronizacji z każdego serwera Next.js.

Koordynacja odbywa się w PostgreSQL:

- Krótkie transakcje przejmują zadania przez `FOR UPDATE SKIP LOCKED`; operacje sieciowe wykonują się poza transakcją. To mechanizm przewidziany również dla wielu konsumentów kolejki. [Dokumentacja PostgreSQL](https://www.postgresql.org/docs/current/sql-select.html)
- Zadania mają termin kolejnej próby, właściciela, token przejęcia i wygasający lease. Stary worker nie może zatwierdzić wyniku po utracie prawa do zadania.
- Unikalność chroni identyfikatory operacji, wiadomości IMAP i aktywną wysyłkę w rozmowie. Wersje szkiców, rozmów i dokumentów zachowują obecną kontrolę konfliktów.
- Restart jednego procesu nie oznacza przerwania operacji innych procesów. Obecne globalne odzyskiwanie wysyłek zastępujemy obsługą wygasłych lease'ów.
- Niepewnego wyniku SMTP nie ponawiamy automatycznie. Błąd zapisu kopii IMAP ponawia wyłącznie kopię. Niepewnego płatnego generowania AI również nie powtarzamy bez świadomej decyzji użytkownika.
- Obecność zapisujemy jako heartbeat w PostgreSQL, z obecnym wygasaniem po 45 sekundach. Nieszkodliwy cache katalogu modeli może pozostać w RAM.

Redis nie jest potrzebny w pierwszej wersji. Nie potrzebujemy też Kubernetes Lease, sticky sessions ani PVC dla aplikacji.

### Zmiany kontraktów API

Wysyłka, generowanie AI i ręczny sync będą zwracać `202` z `operationId`; UI odczyta stan operacji przez API. „W kolejce” nie będzie prezentowane jako „wysłano”. Pozostałe operacje zachowują kontrolę wersji i konflikty rozstrzygane po stronie serwera.

## 4. Dostęp publiczny i sekrety

Uzgodniony docelowy dostęp przez publiczny Internet wymaga rzeczywistego logowania. Obecny selektor pracownika nie jest uwierzytelnieniem, a sama migracja storage nie wystarcza do bezpiecznej ekspozycji prototypu.

- Google OAuth przez Better Auth, sesje w PostgreSQL, bez własnych haseł. Dostęp tylko dla zweryfikowanych adresów z wymaganej allowlisty; pusta lista nie dopuszcza nikogo. [Google](https://better-auth.com/docs/authentication/google), [walidacja tożsamości przed logowaniem](https://better-auth.com/docs/concepts/oauth)
- Jeden poziom uprawnień: każdy dopuszczony pracownik ma dostęp do wszystkich skrzynek i ustawień, również zmiany klucza AI.
- Usuwamy możliwość podszywania się przez selektor pracownika. Autor operacji i właściciel szkicu wynikają z sesji, nie z przesłanego `userId`.
- Wszystkie dane, pliki i operacje wymagają sesji. Cookies: `HttpOnly`, `Secure`, `SameSite`; walidacja pochodzenia żądań zostaje.
- Klucz OpenRouter nadal edytujemy w UI. W bazie zapisujemy szyfrogram AES-256-GCM z identyfikatorem klucza; klucz szyfrujący dostarczamy spoza bazy przez konfigurację sekretów. API zwraca wyłącznie informację „skonfigurowany”, nigdy sekret.
- Dane dostępowe PostgreSQL/S3, Google i IMAP/SMTP również pozostają sekretami środowiska. Kopia klucza szyfrującego jest konieczna do odtworzenia zaszyfrowanych ustawień.

## 5. Start, wdrożenie i kryteria odbioru

Uzgodnione decyzje: czysty start, tylko nowe wiadomości, Google, równe uprawnienia i koordynacja przez PostgreSQL. Poniższe działania są planem na później, nie zadaniami uruchamianymi wraz z zapisaniem dokumentu.

- Nie importujemy lokalnego JSON ani `.eml`; istniejące pliki pozostają nietknięte.
- Przy pierwszym połączeniu zapisujemy `UIDVALIDITY` i `UIDNEXT - 1` jako punkt startowy. Kolejne uruchomienia kontynuują zapisany kursor. Zmiana `UIDVALIDITY` zatrzymuje sync do świadomego ponownego ustalenia punktu startowego.
- Na start pozostaje obecna integracja skrzynki testowej; podłączanie pozostałych skrzynek nie należy do tej migracji.
- Migracje wykonuje osobna komenda przed rolloutem. Web i worker mogą mieć wiele replik; kontenery nie wymagają trwałego filesystemu. Ewentualny `/tmp` lub cache Next.js jest ulotny.
- Przed udostępnieniem wymagane są: domena HTTPS, konfiguracja Google, allowlista, sekrety oraz sprawdzony backup/restore PostgreSQL i S3.

### Testy odbiorowe przed decyzją o produkcji

- [ ] Dwie repliki web i dwa workery: brak zgubionych zmian i podwójnych operacji.
- [ ] Awaria S3 nie przesuwa kursora IMAP; restart nie pobiera starej poczty.
- [ ] Przerwanie wysyłki zachowuje stan niepewny; ponawianie kopii nie wywołuje SMTP.
- [ ] Konflikty szkiców i wiedzy nadal działają; równoległe AI współdzieli operację.
- [ ] Sesja działa między replikami; anonimowy lub niedopuszczony użytkownik nie odczyta poczty, plików ani ustawień.
- [ ] Usunięcie i odtworzenie wszystkich podów aplikacji nie powoduje utraty danych.

Realizacja i wyniki powyższych testów wymagają osobnej weryfikacji. Żaden punkt nie jest potwierdzony przez samo istnienie tego planu.
