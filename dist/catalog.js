export const sizes=['bébé','petite','moyenne','grande','grand-grande'];
export const categories=[{name:'Robes',sub:sizes.map(x=>'Robe '+x)},{name:'Complets filles',sub:sizes.map(x=>'Complet fille '+x)},{name:'Complets garçons',sub:['bébé','petit','moyen','grand','grand-grand'].map(x=>'Complet garçon '+x)},{name:'Jupes',sub:['Jupe petite','Jupe moyenne','Jupe grande']},{name:'Autres',sub:['Hauts','Pantalons','Ensembles']}];
export const normalize=v=>String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function matches(m,query){const text=normalize([m.name,m.reference,m.category,m.subcategory].join(' '));return normalize(query).split(/\s+/).every(word=>text.includes(word))}
