// Globale Daten-Version für Live-Updates. Wird bei jeder Änderung an Zeilen oder
// Aufgaben hochgezählt. Clients pollen die Version leichtgewichtig und laden nur
// dann Zeilen/Aufgaben neu, wenn sich tatsächlich etwas geändert hat.
let dataVersion = 1;

export function bumpDataVersion() {
  dataVersion++;
  return dataVersion;
}

export function getDataVersion() {
  return dataVersion;
}
