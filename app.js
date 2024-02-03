const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting){
            entry.target.classList.add("showElement");
        }
    });
});

const hiddenElements = document.querySelectorAll(".hiddenElement");
hiddenElements.forEach((el) => observer.observe(el));


$(document).keyup(function (e) {
    if (e.keyCode == 13) {
        if (secret.value == "aperture")
            // As above, so below; as within, so without.
            // To those who earnestly seek, the gates of wisdom shall open wide.
            window.location.replace('message.html');
        else 
            secret.value = "";
    }
});
