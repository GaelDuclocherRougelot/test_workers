import type { FormattedRow } from "./format";

// Rendu HTML simple d'un tableau de résultats sous le graphique — vanilla
// DOM, pas de lib. Les colonnes sont dérivées des clés de la première ligne
// (les objets FormattedRow ont tous la même forme au sein d'un même appel).
export function renderTable(container: HTMLElement, rows: FormattedRow[]): void {
  container.replaceChildren();
  if (rows.length === 0) return;

  const columns = Object.keys(rows[0]);

  const table = document.createElement("table");

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const td = document.createElement("td");
      td.textContent = String(row[column]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  container.appendChild(table);
}
