const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        console.log(entry);
        if (entry.isIntersecting){
            entry.target.classList.add("showElement");
        } else {
            entry.target.classList.remove("showElement");
        }
    });
});

const hiddenElements = document.querySelectorAll(".hiddenElement");
hiddenElements.forEach((el) => observer.observe(el));