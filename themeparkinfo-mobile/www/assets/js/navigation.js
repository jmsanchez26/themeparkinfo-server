/**
 * Combined Header & Navigation Loader
 */
function loadSiteComponents() {
  const headerPlaceholder = document.getElementById('header-placeholder');
  const navPlaceholder = document.getElementById('nav-placeholder');

  // Adjust paths based on your folder structure
  const fetchHeader = fetch('../elements/header.html').then(res => res.text());
  const fetchNav = fetch('../elements/nav.html').then(res => res.text());

  Promise.all([fetchHeader, fetchNav])
    .then(([headerHtml, navHtml]) => {
      if (headerPlaceholder) headerPlaceholder.innerHTML = headerHtml;
      if (navPlaceholder) navPlaceholder.innerHTML = navHtml;
      
      // We don't need to call initMenuLogic() if we use delegation below
    })
    .catch(err => console.error("Error loading components:", err));
}

// EVENT DELEGATION: Listen for clicks on the whole document
document.addEventListener("click", (e) => {
  const sideNav = document.getElementById("sideNav");
  const navOverlay = document.getElementById("navOverlay");

  // If the user clicked the Menu Toggle button
  if (e.target.closest("#menuToggle")) {
    sideNav.classList.add("open");
    navOverlay.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  // If the user clicked the Close button OR the Overlay
  if (e.target.closest("#closeNav") || e.target.closest("#navOverlay")) {
    sideNav.classList.remove("open");
    navOverlay.classList.remove("show");
    document.body.style.overflow = "";
  }
});

document.addEventListener("DOMContentLoaded", loadSiteComponents);
