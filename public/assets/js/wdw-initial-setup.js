/*************************
 * DATA STORES
 *************************/
let parks = {
  mg: { rides: [], shows: [], res: [] },
  epcot: { rides: [], shows: [], res: [] },
  ak: { rides: [], shows: [], res: [] },
  hollywood: { rides: [], shows: [], res: [] }
};

/*************************
 * PARK IDS
 *************************/
const PARK_IDS = {
  mg: "75ea578a-adc8-4116-a54d-dccb60765ef9",
  epcot: "47f90d2c-e191-4239-a466-5892ef59a88b",
  ak: "1c84a229-8862-4648-9c71-378ddd2c7693",
  hollywood: "288747d1-8b4f-4a64-867e-ea7c9b27bad8"
};

/*************************
 * API URL
 *************************/
const apiUrl = "/api/wdw";

/*************************
 * RENDERING
 *************************/
function renderAll() {
  renderCards("mg", "rides", ".mg-attractions .card-list");
  renderCards("mg", "shows", ".mg-shows .card-list");
  renderCards("mg", "res", ".mg-res .card-list");

  renderCards("epcot", "rides", ".epcot-attractions .card-list");
  renderCards("epcot", "shows", ".epcot-shows .card-list");
  renderCards("epcot", "res", ".epcot-res .card-list");

  renderCards("ak", "rides", ".animalK-attractions .card-list");
  renderCards("ak", "shows", ".animalK-shows .card-list");
  renderCards("ak", "res", ".animalK-res .card-list");

  renderCards("hollywood", "rides", ".hollywood-attractions .card-list");
  renderCards("hollywood", "shows", ".hollywood-shows .card-list");
  renderCards("hollywood", "res", ".hollywood-res .card-list");
}


/*************************
 * Var
 *************************/
const intialparkHrs = 'magic-kingdom';
const timeZone = 'America/New_York';
const alertVar = 'wdw';

  const idToKey = {
    "magic-kingdom": "mg",
    "epcot": "epcot",
    "hollywood": "hollywood",
    "animalKingdom": "ak"
  };