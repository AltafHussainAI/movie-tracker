// =============================================
// SHARED SCRIPT - MOVIE TRACKER
// =============================================

let movieData = [];

// Load data on page load
document.addEventListener('DOMContentLoaded', async function() {
    await loadMovieData();
    highlightCurrentPage();
});

// Load movie data (with cloud restore fallback)
async function loadMovieData() {
    const savedData = await loadDataWithCloudRestore();

    if (savedData !== null) {
        movieData = savedData;
        console.log('Data loaded:', movieData.length, 'items');
    } else {
        startWithDemoData();
    }

    // Update the page content
    if (typeof updatePageSpecificContent === 'function') {
        updatePageSpecificContent();
    }
}

// Demo data
function startWithDemoData() {
    movieData = [
        { name: "Inception", releaseYear: 2010, duration: 148, type: "Movie" },
        { name: "The Dark Knight", releaseYear: 2008, duration: 152, type: "Movie" },
        { name: "Interstellar", releaseYear: 2014, duration: 169, type: "Movie" },
        { name: "Stranger Things S1", releaseYear: 2016, duration: 406, type: "TV Show" },
        { name: "Stranger Things S2", releaseYear: 2017, duration: 471, type: "TV Show" },
        { name: "Parasite", releaseYear: 2019, duration: 132, type: "Movie" },
        { name: "The Crown S1", releaseYear: 2016, duration: 360, type: "TV Show" },
        { name: "The Matrix", releaseYear: 1999, duration: 136, type: "Movie" },
        { name: "Breaking Bad S1", releaseYear: 2008, duration: 300, type: "TV Show" },
        { name: "Pulp Fiction", releaseYear: 1994, duration: 154, type: "Movie" }
    ];
    saveMovieData();
}

// Save movie data
function saveMovieData() {
    saveData(movieData);
    showSaveIndicator('Data saved', '💾');
}

// Highlight current page
function highlightCurrentPage() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === currentPage) {
            link.classList.add('active');
        }
    });
}

// Show indicator
function showSaveIndicator(message, icon = '💾') {
    let indicator = document.getElementById('saveIndicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'saveIndicator';
        indicator.className = 'save-indicator';
        document.body.appendChild(indicator);
    }
    indicator.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    indicator.style.display = 'flex';
    
    setTimeout(() => {
        indicator.style.display = 'none';
    }, 1500);
}

// Filter data by type
function filterData(type) {
    if (type === 'all') return [...movieData];
    return movieData.filter(item => item && item.type === type);
}

// Sort data
function sortData(data, sortBy) {
    if (!data || data.length === 0) return [];
    
    const sorted = [...data];
    
    switch(sortBy) {
        case 'recent-desc':
            return sorted.sort((a, b) => movieData.indexOf(b) - movieData.indexOf(a));
        case 'recent-asc':
            return sorted.sort((a, b) => movieData.indexOf(a) - movieData.indexOf(b));
        case 'name-asc':
            return sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        case 'name-desc':
            return sorted.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
        case 'duration-desc':
            return sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0));
        case 'duration-asc':
            return sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0));
        case 'year-desc':
            return sorted.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0));
        case 'year-asc':
            return sorted.sort((a, b) => (a.releaseYear || 0) - (b.releaseYear || 0));
        default:
            return sorted;
    }
}