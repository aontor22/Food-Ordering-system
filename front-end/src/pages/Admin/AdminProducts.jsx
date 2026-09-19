import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { food_list as assetProducts } from '../../assets/assets';
import { StoreContext } from '../../context/StoreContext';
import { formatCurrency } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminModal, AdminPageHeader, StatusBadge } from '../../components/admin/AdminUI';

const emptyForm = { name: '', description: '', category: '', imageUrl: '', price: '', stock: '100', isAvailable: true };

export default function AdminProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [availability, setAvailability] = useState('all');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { refreshProducts } = useContext(StoreContext);

  const load = useCallback(async () => {
    setError('');
    try { setProducts((await api.getAdminProducts()).products); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() => [...new Set(products.map(product => product.category))].sort(), [products]);
  const visible = useMemo(() => products.filter(product => {
    const matchSearch = `${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase());
    const matchAvailability = availability === 'all' || (availability === 'active' ? product.isAvailable : !product.isAvailable);
    return matchSearch && matchAvailability;
  }), [products, search, availability]);

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm, category: categories[0] || 'Salad' }); setFormError(''); };
  const openEdit = product => {
    setEditing(product);
    setForm({ name: product.name, description: product.description, category: product.category, imageUrl: product.imageUrl || '', price: (product.priceCents / 100).toFixed(2), stock: String(product.stock), isAvailable: product.isAvailable });
    setFormError('');
  };
  const closeModal = () => { setEditing(null); setForm(null); setFormError(''); };
  const update = event => setForm(previous => ({ ...previous, [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const save = async event => {
    event.preventDefault(); setSaving(true); setFormError('');
    const body = {
      name: form.name, description: form.description, category: form.category,
      imageUrl: form.imageUrl.trim() || null,
      priceCents: Math.round(Number(form.price) * 100), stock: Number(form.stock), isAvailable: form.isAvailable,
    };
    try {
      if (editing) await api.updateAdminProduct(editing.id, body);
      else await api.createAdminProduct(body);
      await Promise.all([load(), refreshProducts()]);
      closeModal();
    } catch (requestError) { setFormError(requestError.message); }
    finally { setSaving(false); }
  };

  const toggleAvailability = async product => {
    try {
      if (product.isAvailable) await api.archiveAdminProduct(product.id);
      else await api.updateAdminProduct(product.id, { isAvailable: true });
      await Promise.all([load(), refreshProducts()]);
    } catch (requestError) { setError(requestError.message); }
  };

  if (loading) return <AdminLoading label="Loading product inventory…" />;
  if (error && !products.length) return <AdminError message={error} retry={load} />;

  return <>
    <AdminPageHeader eyebrow="Menu inventory" title={`${products.length} products`} description="Create dishes, control pricing and keep stock accurate." action={<button className="button button-primary" onClick={openCreate}><Icon name="plus" />Add product</button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-toolbar">
      <label className="admin-search"><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search products or categories…" aria-label="Search products" /></label>
      <select value={availability} onChange={event => setAvailability(event.target.value)} aria-label="Filter availability"><option value="all">All products</option><option value="active">Available</option><option value="archived">Archived</option></select>
    </div>
    <section className="admin-card">
      {visible.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th className="align-right">Actions</th></tr></thead>
        <tbody>{visible.map(product => {
          const image = assetProducts.find(item => item._id === product.id)?.image || product.imageUrl;
          return <tr key={product.id}>
            <td><div className="product-cell"><span className="product-thumb">{image ? <img src={image} alt="" /> : <Icon name="products" />}</span><div><strong>{product.name}</strong><small>{product.description}</small></div></div></td>
            <td>{product.category}</td><td><strong>{formatCurrency(product.priceCents / 100)}</strong></td><td><span className={product.stock <= 10 ? 'stock-low' : 'stock-ok'}>{product.stock}</span></td>
            <td><StatusBadge value={product.isAvailable ? 'ACTIVE' : 'INACTIVE'} /></td>
            <td><div className="admin-table-actions"><button className="admin-icon-action" onClick={() => openEdit(product)} title="Edit product" aria-label={`Edit ${product.name}`}><Icon name="edit" size={17} /></button><button className={`admin-icon-action ${product.isAvailable ? 'is-danger' : 'is-success'}`} onClick={() => toggleAvailability(product)} title={product.isAvailable ? 'Archive product' : 'Restore product'} aria-label={`${product.isAvailable ? 'Archive' : 'Restore'} ${product.name}`}><Icon name={product.isAvailable ? 'archive' : 'refresh'} size={17} /></button></div></td>
          </tr>;
        })}</tbody>
      </table></div> : <AdminEmpty title="No matching products" text="Try changing the search or availability filter." />}
    </section>

    {form && <AdminModal title={editing ? 'Edit product' : 'Add a new product'} subtitle="Changes are reflected in the customer storefront." onClose={closeModal}>
      <form className="admin-form" onSubmit={save}>
        <div className="field-grid"><div className="field"><label htmlFor="product-name">Product name</label><input id="product-name" name="name" required minLength="2" maxLength="100" value={form.name} onChange={update} /></div><div className="field"><label htmlFor="product-category">Category</label><input id="product-category" name="category" required list="product-categories" value={form.category} onChange={update} /><datalist id="product-categories">{categories.map(category => <option key={category} value={category} />)}</datalist></div></div>
        <div className="field"><label htmlFor="product-description">Description</label><textarea id="product-description" name="description" required minLength="5" maxLength="500" value={form.description} onChange={update} /></div>
        <div className="field-grid"><div className="field"><label htmlFor="product-price">Price (USD)</label><input id="product-price" name="price" type="number" required min="0.01" max="100000" step="0.01" value={form.price} onChange={update} /></div><div className="field"><label htmlFor="product-stock">Units in stock</label><input id="product-stock" name="stock" type="number" required min="0" max="1000000" step="1" value={form.stock} onChange={update} /></div></div>
        <div className="field"><label htmlFor="product-image">Image URL (optional)</label><input id="product-image" name="imageUrl" maxLength="500" placeholder="https://… or /image.png" value={form.imageUrl} onChange={update} /></div>
        <label className="toggle-field"><div><p>Available to customers</p><small>Hidden products remain in order history.</small></div><span className="switch"><input name="isAvailable" type="checkbox" checked={form.isAvailable} onChange={update} /><span /></span></label>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="admin-form-footer"><button type="button" className="button button-secondary" onClick={closeModal}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create product'}</button></div>
      </form>
    </AdminModal>}
  </>;
}
