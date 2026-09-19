import { useState } from 'react';
import Header from '../../components/Header/Header';
import ExploreMenu from '../../components/ExploreMenu/ExploreMenu';
import FoodDisplay from '../../components/FoodDisplay/FoodDisplay';
import AppDownload from '../../components/AppDownload/AppDownload';
import Icon from '../../components/ui/Icon';
import './Home.css';

export default function Home() {
  const [category, setCategory] = useState('All');
  return <>
    <Header />
    <section className="benefit-strip" aria-label="Service benefits">
      <div><span><Icon name="delivery" /></span><p><strong>Fast delivery</strong><small>At your door in 30 minutes</small></p></div>
      <div><span><Icon name="spark" /></span><p><strong>Fresh ingredients</strong><small>Prepared after you order</small></p></div>
      <div><span><Icon name="shield" /></span><p><strong>Secure ordering</strong><small>Your information stays protected</small></p></div>
    </section>
    <ExploreMenu category={category} setCategory={setCategory} />
    <FoodDisplay category={category} />
    <AppDownload />
  </>;
}
