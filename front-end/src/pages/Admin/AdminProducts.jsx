import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { StoreContext } from '../../context/StoreContext';
import { formatCurrency } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminModal, AdminPageHeader, StatusBadge } from '../../components/admin/AdminUI';

const emptyForm = { name: '', description: '', category: '', price: '', stock: '100', lowStockThreshold: '10', maxPerOrder: '20', isAvailable: true, optionGroups: [] };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let localKeyCounter = 0;
const localKey = prefix => `${prefix}-${Date.now()}-${localKeyCounter += 1}`;

function displayImage(product) {
  const legacy = typeof product.imageUrl === 'string' && product.imageUrl.match(/^\/food_(\d+)\.(?:png|jpe?g|webp|avif)$/i);
  return legacy ? `/seed-food/food_${legacy[1]}.webp` : product.imageUrl || null;
}

function optionToForm(option) {
  return { trackStock: false, stock: 0, lowStockThreshold: 5, ...option, _key: option.id || localKey('option') };
}

function groupToForm(group) {
  return { ...group, _key: group.id || localKey('group'), options: (group.options || []).map(optionToForm) };
}

function newGroup(kind) {
  return {
    _key: localKey('group'),
    name: kind === 'VARIANT' ? 'Size' : 'Add-ons',
    kind,
    minSelections: kind === 'VARIANT' ? 1 : 0,
    maxSelections: 1,
    sortOrder: 0,
    isAvailable: true,
    options: [
      { _key: localKey('option'), name: kind === 'VARIANT' ? 'Regular' : 'Extra', priceDeltaCents: 0, isDefault: kind === 'VARIANT', sortOrder: 0, isAvailable: true, trackStock: false, stock: 0, lowStockThreshold: 5 },
    ],
  };
}

function serializeGroups(groups) {
  return groups.map((group, groupIndex) => ({
    ...(group.id ? { id: group.id } : {}),
    name: group.name.trim(),
    kind: group.kind,
    minSelections: Number(group.minSelections) || 0,
    maxSelections: Number(group.maxSelections) || 1,
    sortOrder: groupIndex,
    isAvailable: group.isAvailable !== false,
    options: group.options.map((option, optionIndex) => ({
      ...(option.id ? { id: option.id } : {}),
      name: option.name.trim(),
      priceDeltaCents: Math.max(0, Number(option.priceDeltaCents) || 0),
      isDefault: Boolean(option.isDefault),
      sortOrder: optionIndex,
      isAvailable: option.isAvailable !== false,
      trackStock: option.trackStock === true,
      stock: Math.max(0, Number(option.stock) || 0),
      lowStockThreshold: Math.max(0, Number(option.lowStockThreshold) || 0),
    })),
  }));
}

export default function AdminProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [availability, setAvailability] = useState('all');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveStage, setSaveStage] = useState('');
  const [formError, setFormError] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [previewObjectUrl, setPreviewObjectUrl] = useState('');
  const [removeImage, setRemoveImage] = useState(false);
  const [media, setMedia] = useState({ configured: false, legacyImageCount: 0, maxUploadBytes: MAX_IMAGE_BYTES, folder: '' });
  const [migrating, setMigrating] = useState(false);
  const [mediaMessage, setMediaMessage] = useState('');
  const { refreshProducts } = useContext(StoreContext);

  const load = useCallback(async () => {
    setError('');
    try {
      const [productData, mediaData] = await Promise.all([api.getAdminProducts(), api.getAdminMedia()]);
      setProducts(productData.products);
      setMedia(mediaData);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl); }, [previewObjectUrl]);

  const categories = useMemo(() => [...new Set(products.map(product => product.category))].sort(), [products]);
  const visible = useMemo(() => products.filter(product => {
    const matchSearch = `${product.name} ${product.category} ${(product.optionGroups || []).map(group => `${group.name} ${group.options.map(option => option.name).join(' ')}`).join(' ')}`.toLowerCase().includes(search.toLowerCase());
    const matchAvailability = availability === 'all' || (availability === 'active' ? product.isAvailable : !product.isAvailable);
    return matchSearch && matchAvailability;
  }), [products, search, availability]);

  const resetImageState = () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    setPreviewObjectUrl(''); setImageFile(null); setImagePreview(''); setRemoveImage(false);
  };

  const openCreate = () => {
    resetImageState(); setEditing(null);
    setForm({ ...emptyForm, category: categories[0] || 'Salad', optionGroups: [] });
    setFormError('');
  };

  const openEdit = product => {
    resetImageState(); setEditing(product);
    setForm({
      name: product.name, description: product.description, category: product.category,
      price: (product.priceCents / 100).toFixed(2), stock: String(product.stock), lowStockThreshold: String(product.lowStockThreshold ?? 10), maxPerOrder: String(product.maxPerOrder ?? 20), isAvailable: product.isAvailable,
      optionGroups: (product.optionGroups || []).map(groupToForm),
    });
    setImagePreview(displayImage(product) || ''); setFormError('');
  };

  const closeModal = () => {
    resetImageState(); setEditing(null); setForm(null); setFormError(''); setSaveStage('');
  };

  const update = event => setForm(previous => ({ ...previous, [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const addGroup = kind => setForm(previous => ({ ...previous, optionGroups: [...previous.optionGroups, { ...newGroup(kind), sortOrder: previous.optionGroups.length }] }));
  const removeGroup = key => setForm(previous => ({ ...previous, optionGroups: previous.optionGroups.filter(group => group._key !== key) }));
  const updateGroup = (key, changes) => setForm(previous => ({ ...previous, optionGroups: previous.optionGroups.map(group => {
    if (group._key !== key) return group;
    const next = { ...group, ...changes };
    if (changes.kind === 'VARIANT') {
      next.maxSelections = 1;
      next.minSelections = Math.min(1, Number(next.minSelections) || 0);
      let keptDefault = false;
      next.options = next.options.map(option => option.isDefault && !keptDefault ? (keptDefault = true, option) : { ...option, isDefault: false });
    }
    return next;
  }) }));
  const addOption = groupKey => setForm(previous => ({ ...previous, optionGroups: previous.optionGroups.map(group => group._key === groupKey ? {
    ...group,
    options: [...group.options, { _key: localKey('option'), name: '', priceDeltaCents: 0, isDefault: false, sortOrder: group.options.length, isAvailable: true, trackStock: false, stock: 0, lowStockThreshold: 5 }],
  } : group) }));
  const removeOption = (groupKey, optionKey) => setForm(previous => ({ ...previous, optionGroups: previous.optionGroups.map(group => group._key === groupKey ? { ...group, options: group.options.filter(option => option._key !== optionKey) } : group) }));
  const updateOption = (groupKey, optionKey, changes) => setForm(previous => ({ ...previous, optionGroups: previous.optionGroups.map(group => {
    if (group._key !== groupKey) return group;
    const nextOptions = group.options.map(option => option._key === optionKey ? { ...option, ...changes } : (changes.isDefault && group.maxSelections === 1 ? { ...option, isDefault: false } : option));
    return { ...group, options: nextOptions };
  }) }));

  const selectImage = event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) { setFormError('Choose a JPG, PNG, WebP or AVIF image.'); return; }
    const max = media.maxUploadBytes || MAX_IMAGE_BYTES;
    if (file.size > max) { setFormError(`Image must be smaller than ${Math.round(max / 1024 / 1024)} MB.`); return; }
    if (!media.configured) { setFormError('Cloudinary is not configured on the server yet.'); return; }
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    const url = URL.createObjectURL(file); setPreviewObjectUrl(url); setImagePreview(url); setImageFile(file); setRemoveImage(false); setFormError('');
  };

  const clearImage = () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    setPreviewObjectUrl(''); setImagePreview(''); setImageFile(null); setRemoveImage(true); setFormError('');
  };

  const validateCustomizations = () => {
    for (const group of form.optionGroups) {
      if (!group.name.trim()) return 'Every customization group needs a name.';
      if (!group.options.length) return `${group.name || 'Customization group'} needs at least one option.`;
      if (group.options.some(option => !option.name.trim())) return `Every option in ${group.name} needs a name.`;
      const min = Number(group.minSelections) || 0;
      const max = Number(group.maxSelections) || 1;
      const activeOptions = group.options.filter(option => option.isAvailable);
      if (min > max) return `${group.name}: minimum selections cannot exceed maximum selections.`;
      if (max > group.options.length) return `${group.name}: maximum selections cannot exceed its number of options.`;
      if (group.isAvailable && min > activeOptions.length) return `${group.name}: minimum selections cannot exceed its active choices.`;
      if (group.options.some(option => option.isDefault && !option.isAvailable)) return `${group.name}: a default choice must be active.`;
      if (group.kind === 'VARIANT' && max !== 1) return `${group.name}: a variant/size group must allow one choice.`;
    }
    return '';
  };

  const save = async event => {
    event.preventDefault();
    const customizationError = validateCustomizations();
    if (customizationError) { setFormError(customizationError); return; }
    setSaving(true); setSaveStage('Saving…'); setFormError('');
    let uploaded = null;
    const body = {
      name: form.name, description: form.description, category: form.category,
      priceCents: Math.round(Number(form.price) * 100), lowStockThreshold: Number(form.lowStockThreshold), maxPerOrder: Number(form.maxPerOrder), isAvailable: form.isAvailable,
      ...(!editing ? { stock: Number(form.stock) } : {}),
      optionGroups: serializeGroups(form.optionGroups),
    };

    try {
      if (imageFile) {
        setSaveStage('Uploading image to Cloudinary…'); uploaded = await api.uploadProductImage(imageFile);
        body.imageUrl = uploaded.imageUrl; body.imagePublicId = uploaded.imagePublicId;
      } else if (removeImage || !editing) { body.imageUrl = null; body.imagePublicId = null; }

      setSaveStage(editing ? 'Updating product…' : 'Creating product…');
      if (editing) await api.updateAdminProduct(editing.id, body); else await api.createAdminProduct(body);
      await Promise.all([load(), refreshProducts()]); closeModal();
    } catch (requestError) {
      if (uploaded?.imagePublicId) api.cleanupProductImage(uploaded.imagePublicId).catch(() => {});
      setFormError(requestError.message);
    } finally { setSaving(false); setSaveStage(''); }
  };

  const toggleAvailability = async product => {
    try {
      if (product.isAvailable) await api.archiveAdminProduct(product.id); else await api.updateAdminProduct(product.id, { isAvailable: true });
      await Promise.all([load(), refreshProducts()]);
    } catch (requestError) { setError(requestError.message); }
  };

  const migrateImages = async () => {
    setMigrating(true); setMediaMessage(''); setError('');
    try {
      const result = await api.migrateLegacyProductImages();
      setMediaMessage(`Cloudinary migration complete: ${result.migrated} moved, ${result.skipped} skipped${result.failed ? `, ${result.failed} failed` : ''}.`);
      await Promise.all([load(), refreshProducts()]);
    } catch (requestError) { setError(requestError.message); }
    finally { setMigrating(false); }
  };

  if (loading) return <AdminLoading label="Loading product inventory…" />;
  if (error && !products.length) return <AdminError message={error} retry={load} />;

  const headerAction = <div className="admin-header-actions">
    <Link className="button button-secondary" to="/admin/inventory"><Icon name="products" />Inventory</Link>
    {media.configured && media.legacyImageCount > 0 && <button className="button button-secondary" onClick={migrateImages} disabled={migrating}><Icon name="refresh" />{migrating ? 'Moving images…' : `Move ${media.legacyImageCount} images to Cloudinary`}</button>}
    <button className="button button-primary" onClick={openCreate}><Icon name="plus" />Add product</button>
  </div>;

  return <>
    <AdminPageHeader eyebrow="Menu catalogue" title={`${products.length} products`} description="Create dishes, pricing, order limits, sizes/variants and add-ons. Use Inventory for concurrency-safe stock adjustments." action={headerAction} />
    {!media.configured && <div className="media-notice is-warning"><Icon name="alert" /><div><strong>Cloudinary is not configured</strong><p>Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to the backend environment before uploading product images.</p></div></div>}
    {media.configured && <div className="media-notice"><Icon name="check" /><div><strong>Cloudinary media storage is active</strong><p>New product images upload directly from the browser to Cloudinary, so image bytes do not pass through the API or database.</p></div></div>}
    {mediaMessage && <p className="form-success">{mediaMessage}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-toolbar">
      <label className="admin-search"><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search products, categories or options…" aria-label="Search products" /></label>
      <select value={availability} onChange={event => setAvailability(event.target.value)} aria-label="Filter availability"><option value="all">All products</option><option value="active">Available</option><option value="archived">Archived</option></select>
    </div>
    <section className="admin-card">
      {visible.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Category</th><th>Base price</th><th>Stock</th><th>Options</th><th>Wishlist</th><th>Status</th><th className="align-right">Actions</th></tr></thead>
        <tbody>{visible.map(product => {
          const image = displayImage(product); const optionCount = (product.optionGroups || []).reduce((sum, group) => sum + group.options.length, 0);
          return <tr key={product.id}>
            <td><div className="product-cell"><span className="product-thumb">{image ? <img src={image} alt="" loading="lazy" /> : <Icon name="products" />}</span><div><strong>{product.name}</strong><small>{product.description}</small></div></div></td>
            <td>{product.category}</td><td><strong>{formatCurrency(product.priceCents / 100)}</strong></td><td><span className={product.stock <= product.lowStockThreshold ? 'stock-low' : 'stock-ok'}>{product.stock}</span><small> alert ≤ {product.lowStockThreshold}</small></td>
            <td><strong>{product.optionGroups?.length || 0} groups</strong><small>{optionCount} choices</small></td>
            <td><strong>{product.wishlistCount || 0}</strong><small> saves</small></td><td><StatusBadge value={product.isAvailable ? 'ACTIVE' : 'INACTIVE'} /></td>
            <td><div className="admin-table-actions"><button className="admin-icon-action" onClick={() => openEdit(product)} title="Edit product" aria-label={`Edit ${product.name}`}><Icon name="edit" size={17} /></button><button className={`admin-icon-action ${product.isAvailable ? 'is-danger' : 'is-success'}`} onClick={() => toggleAvailability(product)} title={product.isAvailable ? 'Archive product' : 'Restore product'} aria-label={`${product.isAvailable ? 'Archive' : 'Restore'} ${product.name}`}><Icon name={product.isAvailable ? 'archive' : 'refresh'} size={17} /></button></div></td>
          </tr>;
        })}</tbody>
      </table></div> : <AdminEmpty title="No matching products" text="Try changing the search or availability filter." />}
    </section>

    {form && <AdminModal wide title={editing ? 'Edit product' : 'Add a new product'} subtitle="Base price plus selected option price adjustments becomes the server-validated unit price." onClose={closeModal}>
      <form className="admin-form" onSubmit={save}>
        <div className="field-grid"><div className="field"><label htmlFor="product-name">Product name</label><input id="product-name" name="name" required minLength="2" maxLength="100" value={form.name} onChange={update} /></div><div className="field"><label htmlFor="product-category">Category</label><input id="product-category" name="category" required list="product-categories" value={form.category} onChange={update} /><datalist id="product-categories">{categories.map(category => <option key={category} value={category} />)}</datalist></div></div>
        <div className="field"><label htmlFor="product-description">Description</label><textarea id="product-description" name="description" required minLength="5" maxLength="500" value={form.description} onChange={update} /></div>
        <div className="field-grid"><div className="field"><label htmlFor="product-price">Base price</label><input id="product-price" name="price" type="number" required min="0.01" max="100000" step="0.01" value={form.price} onChange={update} /></div><div className="field"><label htmlFor="product-stock">Units in stock</label><input id="product-stock" name="stock" type="number" required min="0" max="1000000" step="1" value={form.stock} onChange={update} disabled={Boolean(editing)} />{editing && <small>Stock is protected from stale edits. Change it in <Link to="/admin/inventory">Inventory</Link>.</small>}</div></div>
        <div className="field-grid"><div className="field"><label htmlFor="product-low-stock">Low-stock alert at</label><input id="product-low-stock" name="lowStockThreshold" type="number" required min="0" max="1000000" step="1" value={form.lowStockThreshold} onChange={update} /></div><div className="field"><label htmlFor="product-max-order">Maximum per order</label><input id="product-max-order" name="maxPerOrder" type="number" required min="1" max="20" step="1" value={form.maxPerOrder} onChange={update} /></div></div>

        <section className="product-options-editor">
          <div className="product-options-editor-head"><div><h3>Sizes, variants & add-ons</h3><p>Variants are single-choice groups such as Size or Crust. Add-ons can allow multiple selections.</p></div><div><button type="button" className="button button-secondary button-small" onClick={() => addGroup('VARIANT')}><Icon name="plus" />Variant</button><button type="button" className="button button-secondary button-small" onClick={() => addGroup('ADDON')}><Icon name="plus" />Add-ons</button></div></div>
          {!form.optionGroups.length && <div className="product-options-empty"><Icon name="products" size={22} /><p>No customization groups. Customers can still add per-item special instructions.</p></div>}
          <div className="product-option-groups">{form.optionGroups.map((group, groupIndex) => <article className="product-option-group" key={group._key}>
            <header><div><strong>Group {groupIndex + 1}</strong><span>{group.kind === 'VARIANT' ? 'Single choice' : 'Add-ons'}</span></div><button type="button" className="admin-icon-action is-danger" onClick={() => removeGroup(group._key)} aria-label="Remove group"><Icon name="trash" size={16} /></button></header>
            <div className="product-option-group-grid">
              <div className="field"><label>Group name</label><input required maxLength="80" value={group.name} onChange={event => updateGroup(group._key, { name: event.target.value })} /></div>
              <div className="field"><label>Type</label><select value={group.kind} onChange={event => updateGroup(group._key, { kind: event.target.value })}><option value="VARIANT">Variant / size</option><option value="ADDON">Add-ons</option></select></div>
              <div className="field"><label>Minimum choices</label><input type="number" min="0" max={group.kind === 'VARIANT' ? 1 : 20} value={group.minSelections} onChange={event => updateGroup(group._key, { minSelections: Math.max(0, Number(event.target.value) || 0) })} /></div>
              <div className="field"><label>Maximum choices</label><input type="number" min="1" max={group.kind === 'VARIANT' ? 1 : Math.max(1, group.options.length)} disabled={group.kind === 'VARIANT'} value={group.kind === 'VARIANT' ? 1 : group.maxSelections} onChange={event => updateGroup(group._key, { maxSelections: Math.max(1, Number(event.target.value) || 1) })} /></div>
            </div>
            <div className="product-option-list">
              <div className="product-option-list-head inventory-enabled"><span>Choice</span><span>Price adjustment</span><span>Stock tracking</span><span>Stock / alert</span><span>Default</span><span>Active</span><span /></div>
              {group.options.map(option => <div className="product-option-row inventory-enabled" key={option._key}>
                <input required maxLength="80" value={option.name} onChange={event => updateOption(group._key, option._key, { name: event.target.value })} placeholder="e.g. Large" />
                <div className="option-price-input"><span>+</span><input type="number" min="0" max="100000" step="0.01" value={(Number(option.priceDeltaCents || 0) / 100).toFixed(2)} onChange={event => updateOption(group._key, option._key, { priceDeltaCents: Math.round(Math.max(0, Number(event.target.value) || 0) * 100) })} /></div>
                <label className="mini-check"><input type="checkbox" checked={option.trackStock === true} onChange={event => updateOption(group._key, option._key, { trackStock: event.target.checked })} /><span>Track</span></label>
                <div className="option-stock-inputs"><input aria-label={`${option.name || 'Option'} stock`} type="number" min="0" max="1000000" step="1" value={option.stock || 0} disabled={!option.trackStock || Boolean(option.id)} onChange={event => updateOption(group._key, option._key, { stock: Math.max(0, Number(event.target.value) || 0) })} title={option.id ? 'Use Inventory to change live stock' : 'Opening stock'} /><input aria-label={`${option.name || 'Option'} low-stock alert`} type="number" min="0" max="1000000" step="1" value={option.lowStockThreshold ?? 5} disabled={!option.trackStock} onChange={event => updateOption(group._key, option._key, { lowStockThreshold: Math.max(0, Number(event.target.value) || 0) })} title="Low-stock alert threshold" /></div>
                <label className="mini-check"><input type="checkbox" checked={Boolean(option.isDefault)} onChange={event => updateOption(group._key, option._key, { isDefault: event.target.checked })} /><span>Default</span></label>
                <label className="mini-check"><input type="checkbox" checked={option.isAvailable !== false} onChange={event => updateOption(group._key, option._key, { isAvailable: event.target.checked })} /><span>Active</span></label>
                <button type="button" className="admin-icon-action is-danger" onClick={() => removeOption(group._key, option._key)} disabled={group.options.length <= 1} aria-label={`Remove ${option.name || 'option'}`}><Icon name="trash" size={15} /></button>
              </div>)}
            </div>
            <button type="button" className="product-option-add" onClick={() => addOption(group._key)}><Icon name="plus" size={15} />Add choice</button>
          </article>)}</div>
        </section>

        <div className="field"><label>Product image</label><div className="product-image-uploader"><div className="product-image-preview">{imagePreview ? <img src={imagePreview} alt="Product preview" /> : <Icon name="products" size={28} />}</div><div className="product-image-copy"><strong>{imageFile ? imageFile.name : imagePreview ? 'Current product image' : 'No image selected'}</strong><small>JPG, PNG, WebP or AVIF. Maximum {Math.round((media.maxUploadBytes || MAX_IMAGE_BYTES) / 1024 / 1024)} MB. The browser uploads directly to Cloudinary.</small><div className="product-image-actions"><label className={`button button-secondary button-small ${!media.configured ? 'is-disabled' : ''}`}><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={selectImage} disabled={!media.configured || saving} />{imagePreview ? 'Replace image' : 'Choose image'}</label>{imagePreview && <button type="button" className="button button-ghost button-small" onClick={clearImage} disabled={saving}>Remove</button>}</div></div></div></div>
        <label className="toggle-field"><div><p>Available to customers</p><small>Hidden products remain in order history.</small></div><span className="switch"><input name="isAvailable" type="checkbox" checked={form.isAvailable} onChange={update} /><span /></span></label>
        {saveStage && saving && <p className="upload-stage"><span className="mini-spinner" />{saveStage}</p>}{formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="admin-form-footer"><button type="button" className="button button-secondary" onClick={closeModal} disabled={saving}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? saveStage || 'Saving…' : editing ? 'Save changes' : 'Create product'}</button></div>
      </form>
    </AdminModal>}
  </>;
}
