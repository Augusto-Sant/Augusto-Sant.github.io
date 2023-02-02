const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting){
            entry.target.classList.add("showElement");
        } else {
            entry.target.classList.remove("showElement");
        }
    });
});

const hiddenElements = document.querySelectorAll(".hiddenElement");
hiddenElements.forEach((el) => observer.observe(el));
