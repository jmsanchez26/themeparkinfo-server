async function checkUniversalDiningAvailability(query) {
  return {
    available: false,
    matches: [],
    source: "unconfigured",
    note: "Universal dining automation has not been connected yet."
  };
}

module.exports = {
  checkUniversalDiningAvailability
};
