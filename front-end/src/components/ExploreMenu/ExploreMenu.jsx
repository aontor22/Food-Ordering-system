import { useContext, useEffect, useMemo } from 'react';
import { menu_list } from '../../assets/assets';
import { StoreContext } from '../../context/StoreContext';
import './ExploreMenu.css';

const presetImages = new Map(menu_list.map(item => [item.menu_name.toLowerCase(), item.menu_image]));

function normalizeCategory(value) {
  return String(value || '').trim();
}

export default function ExploreMenu({ category, setCategory }) {
  const { food_list } = useContext(StoreContext);

  const categories = useMemo(() => {
    const byName = new Map();

    (food_list || []).forEach(product => {
      if (product?.isAvailable === false) return;
      const name = normalizeCategory(product?.category);
      if (!name) return;
      const key = name.toLowerCase();
      const current = byName.get(key);
      if (!current) {
        byName.set(key, {
          menu_name: name,
          menu_image: presetImages.get(key) || product.image || null,
        });
      } else if (!current.menu_image && product.image) {
        current.menu_image = product.image;
      }
    });

    const presetOrder = new Map(menu_list.map((item, index) => [item.menu_name.toLowerCase(), index]));
    return [...byName.values()].sort((a, b) => {
      const aPreset = presetOrder.get(a.menu_name.toLowerCase());
      const bPreset = presetOrder.get(b.menu_name.toLowerCase());
      if (aPreset != null && bPreset != null) return aPreset - bPreset;
      if (aPreset != null) return -1;
      if (bPreset != null) return 1;
      return a.menu_name.localeCompare(b.menu_name, undefined, { sensitivity: 'base' });
    });
  }, [food_list]);

  useEffect(() => {
    if (category === 'All') return;
    if (!categories.some(item => item.menu_name === category)) setCategory('All');
  }, [categories, category, setCategory]);

  return <section className="section explore-menu" id="menu">
    <div className="section-heading">
      <div><div className="section-kicker">Something for everyone</div><h2>Explore our menu</h2></div>
      <p>From crisp salads to comforting pasta, find a dish for every craving and every moment.</p>
    </div>

    <div className="category-strip" aria-label="Food categories">
      <button
        type="button"
        className={`category-card category-card-all ${category === 'All' ? 'active' : ''}`}
        onClick={() => setCategory('All')}
        aria-pressed={category === 'All'}
      >
        <span className="all-category">All</span>
        <span>All</span>
      </button>

      <div className="category-scroll" role="region" aria-label="Scroll food categories" tabIndex="0">
        <div className="category-track" role="group" aria-label="Available categories">
          {categories.map(item => <button
            type="button"
            key={item.menu_name}
            className={`category-card ${category === item.menu_name ? 'active' : ''}`}
            onClick={() => setCategory(item.menu_name)}
            aria-pressed={category === item.menu_name}
          >
            {item.menu_image
              ? <img src={item.menu_image} alt="" loading="lazy" />
              : <span className="category-fallback" aria-hidden="true">{item.menu_name.slice(0, 1).toUpperCase()}</span>}
            <span className="category-name" title={item.menu_name}>{item.menu_name}</span>
          </button>)}
        </div>
      </div>
    </div>
  </section>;
}
