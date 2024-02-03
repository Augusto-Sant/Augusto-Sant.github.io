const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting){
            entry.target.classList.add("showElement");
        }
    });
});

const hiddenElements = document.querySelectorAll(".hiddenElement");
hiddenElements.forEach((el) => observer.observe(el));

document.addEventListener('keyup', function(e) {
    var secret = document.getElementById('secret');
    // As above, so below; as within, so without.
    // To those who earnestly seek, the gates of wisdom shall open wide.
    if (e.keyCode === 13) {
        if (secret.value === "aperture") {
            secret.value = "";
            secret.value = "Thanks :)";
        } else {
            secret.value = "";
        }
    }
});
