# Regressietests voor werkopdrachten verwijderen

Vereist Node.js 22 of nieuwer; geen npm-installatie nodig. Vanuit de repositoryroot:

```sh
node --test tests/verwijder-werkopdracht.test.cjs
```

De tests lezen de daadwerkelijke `sb()`, rechtencontrole en `verwijderWerkopdracht` uit `index.html` en voeren deze uit in een geïsoleerde Node VM. `fetch` is volledig vervangen door een lokale simulator met een `.invalid`-URL en een testsleutel. De applicatie wordt niet gestart; er worden geen netwerkverzoeken of echte gegevensverwijderingen uitgevoerd.

Getest worden alle vijf rapporttabellen voor twee werkorders, HTTP- en netwerkfouten bij iedere stap, een verloren antwoord na een geslaagde delete, fouten bij beide oudertabellen, lege werkopdrachten, toegestane en geweigerde gebruikers (inclusief bestaande naamalias), directe verwijdering zonder prompt/confirm, dubbelklikken en een nieuwe poging na een fout. Bij iedere fout controleren de tests dat geen volgende databaseverzoeken of succesverversing plaatsvinden. Ook wordt de syntax van alle inline scripts gecontroleerd. Dit zijn functietests, geen volledige browsertests.

## Begrenzing van de reparatie

De browser voert losse REST-verzoeken uit. De eerste fout stopt de reeks en wordt zichtbaar gemeld. Werkorders worden pas verwijderd nadat alle rapportverwijderingen slagen; de werkopdracht volgt pas na de werkorders. Een ref voorkomt overlappende verwijderacties binnen dezelfde App-instantie en wordt na succes en fouten vrijgegeven.

Eerdere geslaagde verzoeken kunnen niet worden teruggedraaid. Bij een verbroken verbinding kan bovendien onduidelijk zijn of de laatste delete is uitgevoerd. De melding waarschuwt daarom dat er mogelijk al gegevens zijn verwijderd. De ref beschermt niet tegen andere tabbladen of gebruikers. Volledige atomiciteit vergt een afzonderlijk gecontroleerde databasewijziging met een transactie (bijvoorbeeld een RPC of geschikte foreign keys met cascades), inclusief behoud van database-autorisatie. Deze repository bevat geen schema of migraties om zo'n wijziging betrouwbaar op te baseren; deze reparatie wijzigt de database niet.
