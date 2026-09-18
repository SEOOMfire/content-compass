# Datenbank in ein eigenes Supabase-Projekt umziehen

Inhalt dieses Ordners:

| Datei | Zweck |
| --- | --- |
| `setup.sql` | Kompletter Nachbau: Extensions, Enum, Tabellen, Constraints, Indexe, Fremdschlüssel, Funktionen, Trigger, RLS, Policies, Grants und die Stammdaten (Märkte, Prompts, Prompt-Historie, Rollen). Idempotent – mehrfaches Ausführen ist unschädlich. |
| `env.example` | Vorlage aller Umgebungsvariablen mit Platzhaltern. |
| `optional/*.sql.gz` | Gelernte Daten und Historie (Link-Pool, geprüfte Links, Jobs, Job-Schritte). Nur einspielen, wenn gewünscht. Vorher entpacken: `gunzip -k datei.sql.gz`. |

Das Schema stammt aus einem `pg_dump` der echten Datenbank, nicht aus `drizzle/migrations`.

## Schritt für Schritt

1. **Neues Supabase-Projekt anlegen** (Region und Passwort frei wählbar) und warten, bis es bereitsteht.
2. **`setup.sql` ausführen**: Inhalt der Datei in den SQL-Editor des neuen Projekts einfügen und ausführen. Danach existieren alle Tabellen, Policies, Funktionen, Trigger und die Stammdaten.
3. **Auth konfigurieren**: Authentication → Providers → *Email* aktivieren (Passwort-Login wie bisher). Unter Authentication → URL Configuration die Site-URL und die Redirect-URL `…/reset-password` eintragen.
4. **Ersten Nutzer registrieren**: Über die Login-Maske der App anmelden/registrieren. Der Trigger `on_auth_user_created_grant_admin` macht den allerersten Nutzer automatisch zum Admin. Alternativ die Rollen aus Abschnitt 12.4 der `setup.sql` verwenden – die dortigen Nutzer-IDs funktionieren aber nur, wenn dieselben Konten im neuen Projekt existieren.
5. **`.env.local` anlegen**: `env.example` kopieren und mit den Werten des neuen Projekts füllen. Der `service_role`-Schlüssel gehört ausschließlich in diese lokale Datei – nie ins Repo und nie in einen Chat.
6. **Starten und prüfen**: `bun install` und `bun dev`. Prüfen: Login, Märkte-Liste, Admin → Prompts (13 Vorlagen), Testjob anlegen.
7. **Optional**: gelernte Daten aus `optional/` einspielen. Reihenfolge: `link_pool` (nach den Märkten) sowie `jobs` → `job_steps` → `verified_links`.

## Zurück zu Lovable

Einfach die ursprünglichen `.env`-Werte wiederherstellen – am Code muss nichts geändert werden.
