import { useContext, useMemo } from 'react';
import { StoreContext } from '../../context/StoreContext';
import FoodItem from '../FoodItem/FoodItem';
import Icon from '../ui/Icon';
import './FoodDisplay.css';

export default function FoodDisplay({ category }) {
  const { food_list, loading, searchQuery, setSearchQuery } = useContext(StoreContext);
  const foods = useMemo(() => food_list.filter(item => {
    const categoryMatch = category === 'All' || item.category === category;
    const query = searchQuery.trim().toLowerCase();
    return categoryMatch && (!query || `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(query));
  }), [food_list, category, searchQuery]);

  return <section className="section dishes" id="dishes">
    <div className="dishes-toolbar">
      <div><div className="section-kicker">Made fresh for you</div><h2>{category === 'All' ? 'Popular dishes' : category}</h2><p>{loading ? 'Loading today’s menu…' : `${foods.length} ${foods.length === 1 ? 'dish' : 'dishes'} available`}</p></div>
      {searchQuery && <button className="search-chip" onClick={() => setSearchQuery('')}><Icon name="search" size={15} />“{searchQuery}” <Icon name="close" size={15} /></button>}
    </div>
    {loading ? <div className="food-grid">{Array.from({length: 8}, (_, index) => <div className="food-skeleton" key={index}><div/><span/><span/></div>)}</div>
      : foods.length ? <div className="food-grid">{foods.map(item => <FoodItem key={item._id} item={item} />)}</div>
      : <div className="no-results"><span>🔎</span><h3>No dishes found</h3><p>Try another category or clear your search.</p><button className="button button-secondary" onClick={() => setSearchQuery('')}>Clear search</button></div>}
  </section>;
}
