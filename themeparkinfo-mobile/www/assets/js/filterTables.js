document.querySelectorAll(".table-wrapper").forEach(initTable);

function initTable(wrapper) {
  const table = wrapper.querySelector(".sortable-table");
  if (!table) return;

  const tbody = table.tBodies[0];
  const headers = Array.from(table.querySelectorAll("th"));
  const searchInput = wrapper.querySelector(".table-search");

  const sortState = Object.create(null);

  /* =========================
     Search
  ========================= */
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase();

      Array.from(tbody.rows).forEach(row => {
        row.hidden = !row.textContent.toLowerCase().includes(query);
      });
    });
  }

  /* =========================
     Sort
  ========================= */
  headers.forEach((header, colIndex) => {
    sortState[colIndex] = true;

    header.addEventListener("click", () => {
      const type = header.dataset.sort || "string";
      const direction = sortState[colIndex] ? 1 : -1;
      sortState[colIndex] = !sortState[colIndex];

      const rows = Array.from(tbody.rows);

      rows.sort((rowA, rowB) => {
        let a = rowA.cells[colIndex].textContent.trim();
        let b = rowB.cells[colIndex].textContent.trim();

        if (type === "number") {
          a = Number(a) || 0;
          b = Number(b) || 0;
          return (a - b) * direction;
        }

        return a.localeCompare(b, undefined, { numeric: true }) * direction;
      });

      tbody.append(...rows);
    });
  });
}
