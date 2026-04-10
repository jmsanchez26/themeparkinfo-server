/**
 * Combined Header & Navigation Loader
 */
function loadSiteComponents() {
  const headerPlaceholder = document.getElementById('header-placeholder');
  const navPlaceholder = document.getElementById('nav-placeholder');
  const footerPlaceholder = document.getElementById('footer-placeholder');

  // Adjust paths based on your folder structure
  const fetchHeader = fetch('../elements/header.html').then(res => res.text());
  const fetchNav = fetch('../elements/nav.html').then(res => res.text());
  const fetchFooter = fetch('../elements/footer.html').then(res => res.text());

  Promise.all([fetchHeader, fetchNav, fetchFooter])
    .then(([headerHtml, navHtml, footerHtml]) => {
      if (headerPlaceholder) headerPlaceholder.innerHTML = headerHtml;
      if (navPlaceholder) navPlaceholder.innerHTML = navHtml;
      if (footerPlaceholder) footerPlaceholder.innerHTML = footerHtml;
      
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
