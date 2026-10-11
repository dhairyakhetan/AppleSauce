/**
 * Kolkata areas and the spellings that map onto them.
 *
 * Moved out of searchKeywordExtractor.ts unchanged so build scripts can import
 * it (that file pulls in a browser-only path alias). The search box, the area
 * filter and src/lib/locality.ts all read this one table.
 */

export const AREAS = [
  // Group 1
  'Alipore', 'Ballygunge', 'Behala', 'Bhowanipore', 'Gariahat', 'Garia', 'Jadavpur', 'Kasba', 
  'New Alipore', 'Southern Avenue', 'Tollygunge', 'Hazra',
  // Group 2
  'Baguihati', 'Belur', 'Howrah', 'Joka', 'Newtown', 'Rajarhat', 'Salt Lake', 'Science City',
  // Group 3
  'Dum Dum', 'Entally', 'Girish Park', 'Nagarbazar', 'Sealdah', 'Shyam Bazar', 'Tangra',
  // Group 4
  'Camac Street', 'College Street', 'Elgin', 'Minto Park', 'Park Street', 'Park Circus',
  // Group 5
  'Kankurgachi', 'Laketown', 'Phoolbagan', 'Ultadanga',
  // Group 6
  'Anandapur', 'Parnasree', 'Rabindra Nagar',
  // Group 7
  'Hooghly'
].sort();

// --- NORMALIZATION MAPS ---
export const AREA_NORMALIZATION: Record<string, string> = {
  // Group 1 - Alipore variations
  'alipur': 'Alipore', 'alipor': 'Alipore', 'alipore': 'Alipore',
  
  // Group 1 - Ballygunge variations
  'ballygunge': 'Ballygunge', 'ballygunj': 'Ballygunge', 'ballyganj': 'Ballygunge',
  
  // Group 1 - Behala variations
  'behala': 'Behala', 'behung': 'Behala',
  
  // Group 1 - Bhowanipore variations
  'bhowanipur': 'Bhowanipore', 'bhawanipur': 'Bhowanipore', 'bhawanipore': 'Bhowanipore',
  'bhowanipore': 'Bhowanipore', 'bhawanipor': 'Bhowanipore',
  
  // Group 1 - Gariahat variations
  'gariahat': 'Gariahat', 'garia hat': 'Gariahat',
  
  // Group 1 - Garia variations
  'garia': 'Garia',
  
  // Group 1 - Jadavpur variations
  'jadabpur': 'Jadavpur', 'jadavpur': 'Jadavpur',
  
  // Group 1 - Kasba variations
  'kasba': 'Kasba',
  
  // Group 1 - New Alipore variations
  'newalipore': 'New Alipore', 'new alipore': 'New Alipore', 'new alipur': 'New Alipore',
  
  // Group 1 - Southern Avenue variations
  'southern avenue': 'Southern Avenue', 'southernavenue': 'Southern Avenue', 'southern': 'Southern Avenue',
  
  // Group 1 - Tollygunge variations
  'tollygunge': 'Tollygunge', 'tollygunj': 'Tollygunge', 'tollyganj': 'Tollygunge', 'tolly': 'Tollygunge',
  
  // Group 1 - Hazra variations
  'hazra': 'Hazra',
  
  // Group 2 - Baguihati variations
  'baguihati': 'Baguihati', 'bagui hati': 'Baguihati',
  
  // Group 2 - Belur variations
  'belur': 'Belur',
  
  // Group 2 - Howrah variations
  'howrah': 'Howrah', 'haora': 'Howrah', 'salkia': 'Howrah', 'ac market': 'Howrah', 'bandhaghat': 'Howrah',
  
  // Group 2 - Joka variations
  'joka': 'Joka',
  
  // Group 2 - Newtown variations
  'newtown': 'Newtown', 'new town': 'Newtown', 'newtown kolkata': 'Newtown',
  
  // Group 2 - Rajarhat variations
  'rajarhat': 'Rajarhat', 'rajar hat': 'Rajarhat',
  
  // Group 2 - Salt Lake variations
  'saltlake': 'Salt Lake', 'salt lake': 'Salt Lake', 'bidhannagar': 'Salt Lake', 
  'sector 1': 'Salt Lake', 'sector 2': 'Salt Lake', 'sector 3': 'Salt Lake', 'sector 5': 'Salt Lake',
  
  // Group 2 - Science City variations
  'science city': 'Science City', 'sciencecity': 'Science City', 'science': 'Science City',
  
  // Group 3 - Dum Dum variations
  'dumdum': 'Dum Dum', 'dum dum': 'Dum Dum',
  
  // Group 3 - Entally variations
  'entally': 'Entally', 'entali': 'Entally',
  
  // Group 3 - Girish Park variations
  'girish park': 'Girish Park', 'girishpark': 'Girish Park', 'girish': 'Girish Park',
  
  // Group 3 - Nagarbazar variations
  'nagarbazar': 'Nagarbazar', 'nagar bazar': 'Nagarbazar', 'nagar': 'Nagarbazar',
  
  // Group 3 - Sealdah variations
  'sealdah': 'Sealdah', 'sialdah': 'Sealdah',
  
  // Group 3 - Shyam Bazar variations
  'shyam bazar': 'Shyam Bazar', 'shyambazar': 'Shyam Bazar', 'shyam bazaar': 'Shyam Bazar',
  
  // Group 3 - Tangra variations
  'tangra': 'Tangra',
  
  // Group 4 - Camac Street variations
  'camac street': 'Camac Street', 'camacstreet': 'Camac Street', 'camac': 'Camac Street',
  
  // Group 4 - College Street variations
  'college street': 'College Street', 'collegestreet': 'College Street', 'college': 'College Street',
  
  // Group 4 - Elgin variations
  'elgin': 'Elgin', 'elgin road': 'Elgin',
  
  // Group 4 - Minto Park variations
  'minto park': 'Minto Park', 'mintopark': 'Minto Park', 'minto': 'Minto Park',
  
  // Group 4 - Park Street variations
  'parkstreet': 'Park Street', 'park street': 'Park Street', 'park st': 'Park Street',
  
  // Group 4 - Park Circus variations
  'park circus': 'Park Circus', 'parkcircus': 'Park Circus',
  
  // Group 5 - Kankurgachi variations
  'kankurgachi': 'Kankurgachi', 'kankur gachi': 'Kankurgachi',
  
  // Group 5 - Laketown variations
  'laketown': 'Laketown', 'lake town': 'Laketown', 'lake': 'Laketown',
  
  // Group 5 - Phoolbagan variations
  'phoolbagan': 'Phoolbagan', 'phool bagan': 'Phoolbagan', 'phool': 'Phoolbagan',
  
  // Group 5 - Ultadanga variations
  'ultadanga': 'Ultadanga', 'ulta danga': 'Ultadanga',
  
  // Group 6 - Anandapur variations
  'anandapur': 'Anandapur', 'ananda pur': 'Anandapur',
  
  // Group 6 - Parnasree variations
  'parnasree': 'Parnasree', 'parna sree': 'Parnasree',
  
  // Group 6 - Rabindra Nagar variations
  'rabindra nagar': 'Rabindra Nagar', 'rabindranagar': 'Rabindra Nagar', 'rabindra': 'Rabindra Nagar',
  
  // Group 7 - Hooghly variations
  'hooghly': 'Hooghly', 'hugli': 'Hooghly', 'chandannagar': 'Hooghly', 'serampore': 'Hooghly', 'chandannagore': 'Hooghly'
};
