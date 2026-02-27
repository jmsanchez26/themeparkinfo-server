  const menuToggle = document.getElementById("menuToggle");
  const sideNav = document.getElementById("sideNav");
  const navOverlay = document.getElementById("navOverlay");
  const closeNav = document.getElementById("closeNav");

  function openNav() {
    sideNav.classList.add("open");
    navOverlay.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeNavigation() {
    sideNav.classList.remove("open");
    navOverlay.classList.remove("show");
    document.body.style.overflow = "";
  }

  menuToggle.addEventListener("click", openNav);
  closeNav.addEventListener("click", closeNavigation);
  navOverlay.addEventListener("click", closeNavigation);

