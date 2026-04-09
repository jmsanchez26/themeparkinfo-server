/*************************
 * DATA STORES
 *************************/
let parks = {
  disneyland: { rides: [], shows: [], res: [] },
  caliadv: { rides: [], shows: [], res: [] }
};

/*************************
 * PARK IDS
 *************************/
const PARK_IDS = {
  disneyland: "7340550b-c14d-4def-80bb-acdb51d49a66",
  caliadv: "832fcd51-ea19-4e77-85c7-75d5843b127c"
};

/*************************
 * API URL
 *************************/
const apiUrl = `${window.__API_BASE__}/api/disneyland`;

/*************************
 * RENDERING
 *************************/
function renderAll() {
  renderCards("disneyland", "rides", ".disneyland-attractions .card-list");
  renderCards("disneyland", "shows", ".disneyland-shows .card-list");
  renderCards("disneyland", "res", ".disneyland-res .card-list");

  renderCards("caliadv", "rides", ".caliadv-attractions .card-list");
  renderCards("caliadv", "shows", ".caliadv-shows .card-list");
  renderCards("caliadv", "res", ".caliadv-res .card-list");
}

/*************************
 * Hours Var
 *************************/
const intialparkHrs = 'disneyland';
const timeZone = 'America/Los_Angeles';
const alertVar = 'disneyland';

  const idToKey = {
    "disneyland": "disneyland",
    "caliadv": "caliadv"
  };