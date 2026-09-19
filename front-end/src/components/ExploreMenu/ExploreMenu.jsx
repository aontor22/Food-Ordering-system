import { menu_list } from '../../assets/assets';
import './ExploreMenu.css';

export default function ExploreMenu({ category, setCategory }) {
  const categories = [{ menu_name: 'All', menu_image: null }, ...menu_list];
  return <section className="section explore-menu" id="menu">
    <div className="section-heading">
      <div><div className="section-kicker">Something for everyone</div><h2>Explore our menu</h2></div>
      <p>From crisp salads to comforting pasta, find a dish for every craving and every moment.</p>
    </div>
    <div className="category-list" role="list" aria-label="Food categories">
      {categories.map(item => <button key={item.menu_name} className={`category-card ${category === item.menu_name ? 'active' : ''}`} onClick={() => setCategory(item.menu_name)} aria-pressed={category === item.menu_name}>
        {item.menu_image ? <img src={item.menu_image} alt="" /> : <span className="all-category">All</span>}
        <span>{item.menu_name}</span>
      </button>)}
    </div>
  </section>;
}
