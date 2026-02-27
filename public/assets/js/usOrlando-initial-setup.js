/*************************
 * DATA STORES
 *************************/
let parks = {
  usfl: { rides: [], shows: [], res: [] },
  islandofAdventure: { rides: [], shows: [], res: [] },
  epic: { rides: [], shows: [], res: [] },
  volcanoBay: { rides: [], shows: [], res: [] }
};


/*************************
 * PARK IDS
 *************************/
const PARK_IDS = {
  usfl: "eb3f4560-2383-4a36-9152-6b3e5ed6bc57",
  islandofAdventure: "267615cc-8943-4c2a-ae2c-5da728ca591f",
  epic: "12dbb85b-265f-44e6-bccf-f1faa17211fc",
  volcanoBay: "fe78a026-b91b-470c-b906-9d2266b692da"
};

/*************************
 * API URL
 *************************/
const apiUrl = "/api/usOrlando";
/*************************
 * RENDERING
 *************************/
function renderAll() {
  renderCards("usfl", "rides", ".usfl-attractions .card-list");
  renderCards("usfl", "shows", ".usfl-shows .card-list");
  renderCards("usfl", "res", ".usfl-res .card-list");

  renderCards("islandofAdventure", "rides", ".islandofAdventure-attractions .card-list");
  renderCards("islandofAdventure", "shows", ".islandofAdventure-shows .card-list");

  renderCards("epic", "rides", ".epic-attractions .card-list");
  renderCards("epic", "shows", ".epic-shows .card-list");

  renderCards("volcanoBay", "rides", ".volcanoBay-attractions .card-list");
  renderCards("volcanoBay", "shows", ".volcanoBay-shows .card-list");
}

/*************************
 * Var
 *************************/
const intialparkHrs = 'usfl';
const timeZone = 'America/New_York';
const alertVar = 'usOrlando';

  const idToKey = {
    "usOrlando": "usOrlando"
  };