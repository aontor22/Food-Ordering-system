import { useContext, useMemo, useState } from 'react';
import { StoreContext } from '../../context/StoreContext';
import { DIETARY_OPTIONS, SORT_OPTIONS, filterAndSortProducts } from '../../lib/productDiscovery';
import FoodItem from '../FoodItem/FoodItem';
import Icon from '../ui/Icon';
import './FoodDisplay.css';

export default function FoodDisplay({ category }) {
  const { food_list, loading, searchQuery, setSearchQuery } = useContext(StoreContext);
  const [dietary, setDietary] = useState([]);
  const [sort, setSort] = useState('RECOMMENDED');
  const [minRating, setMinRating] = useState('0');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  const foods = useMemo(() => filterAndSortProducts(food_list, {
    category, search: searchQuery, dietary, sort,
    minRating: Number(minRating) || 0, minPrice, maxPrice,
  }), [food_list, category, searchQuery, dietary, sort, minRating, minPrice, maxPrice]);

  const activeFilterCount = dietary.length + (Number(minRating) > 0 ? 1 : 0) + (minPrice !== '' ? 1 : 0) + (maxPrice !== '' ? 1 : 0);
  const toggleDietary = key => setDietary(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key]);
  const clearDiscovery = () => {
    setSearchQuery(''); setDietary([]); setSort('RECOMMENDED'); setMinRating('0'); setMinPrice(''); setMaxPrice('');
  };

  return <section className="section dishes" id="dishes">
    <div className="dishes-toolbar">
      <div><div className="section-kicker">Made fresh for you</div><h2>{category === 'All' ? 'Explore the menu' : category}</h2><p>{loading ? 'Loading today’s menu…' : `${foods.length} ${foods.length === 1 ? 'dish' : 'dishes'} match your selection`}</p></div>
      <div className="dishes-toolbar-actions">
        {searchQuery && <button className="search-chip" onClick={() => setSearchQuery('')}><Icon name="search" size={15} />“{searchQuery}” <Icon name="close" size={15} /></button>}
        {(activeFilterCount > 0 || sort !== 'RECOMMENDED') && <button className="discovery-clear" type="button" onClick={clearDiscovery}>Clear {activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'}` : 'sort'}</button>}
      </div>
    </div>

    <div className="discovery-panel" aria-label="Menu filters and sorting">
      <div className="discovery-search">
        <Icon name="search" size={18} />
        <input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search dishes, ingredients, sizes or add-ons…" aria-label="Search menu" />
        {searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear menu search"><Icon name="close" size={17} /></button>}
      </div>
      <div className="discovery-dietary" aria-label="Dietary filters">
        {DIETARY_OPTIONS.map(option => <button key={option.key} type="button" className={dietary.includes(option.key) ? 'is-active' : ''} aria-pressed={dietary.includes(option.key)} onClick={() => toggleDietary(option.key)}>{option.label}</button>)}
      </div>
      <div className="discovery-controls">
        <label><span>Minimum rating</span><select value={minRating} onChange={event => setMinRating(event.target.value)}><option value="0">Any rating</option><option value="4">4★ & up</option><option value="4.5">4.5★ & up</option></select></label>
        <label><span>Min price</span><input type="number" min="0" step="1" inputMode="decimal" value={minPrice} onChange={event => setMinPrice(event.target.value)} placeholder="0" /></label>
        <label><span>Max price</span><input type="number" min="0" step="1" inputMode="decimal" value={maxPrice} onChange={event => setMaxPrice(event.target.value)} placeholder="Any" /></label>
        <label className="discovery-sort"><span>Sort by</span><select value={sort} onChange={event => setSort(event.target.value)}>{SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
    </div>

    {loading ? <div className="food-grid">{Array.from({length: 8}, (_, index) => <div className="food-skeleton" key={index}><div/><span/><span/></div>)}</div>
      : foods.length ? <div className="food-grid">{foods.map(item => <FoodItem key={item._id} item={item} />)}</div>
      : <div className="no-results"><span>🔎</span><h3>No dishes found</h3><p>Try another category, price range or dietary selection.</p><button className="button button-secondary" onClick={clearDiscovery}>Clear search & filters</button></div>}
  </section>;
}
