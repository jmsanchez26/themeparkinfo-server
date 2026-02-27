/*************************
 * DATA STORES
 *************************/
let parks = {
  usHollywood: { rides: [], shows: [] }
};

/*************************
 * PARK IDS
 *************************/
const PARK_IDS = {
  usHollywood: "bc4005c5-8c7e-41d7-b349-cdddf1796427"
};

/*************************
 * API URL
 *************************/
const apiUrl = "/api/hollywood";
/*************************
 * RENDERING
 *************************/
function renderAll() {
  renderCards("usHollywood", "rides", ".usHollywood-attractions .card-list");
  renderCards("usHollywood", "shows", ".usHollywood-shows .card-list");
  renderCards("usHollywood", "res", ".usHollywood-res .card-list");
}


/*************************
 * Var
 *************************/
const intialparkHrs = 'usHollywood';
const timeZone = 'America/Los_Angeles';
const alertVar = 'usHollywood';

  const idToKey = {
    "usHollywood": "usHollywood"
  };