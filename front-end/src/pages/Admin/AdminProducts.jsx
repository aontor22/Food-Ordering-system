import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { food_list as assetProducts } from '../../assets/assets';
import { StoreContext } from '../../context/StoreContext';
import { formatCurrency } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminModal, AdminPageHeader, StatusBadge } from '../../components/admin/AdminUI';

const emptyForm = { name: '', description: '', category: '', price: '', stock: '100', isAvailable: true };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function displayImage(product) {
  const imageUrl = product.imageUrl || '';
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (/^\/food_\d+\.(png|jpe?g|webp|avif)$/i.test(imageUrl)) return assetProducts.find(item => item._id === product.id)?.image || imageUrl;
  return imageUrl || null;
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
    const matchSearch = `${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase());
    const matchAvailability = availability === 'all' || (availability === 'active' ? product.isAvailable : !product.isAvailable);
    return matchSearch && matchAvailability;
  }), [products, search, availability]);

  const resetImageState = () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    setPreviewObjectUrl('');
    setImageFile(null);
    setImagePreview('');
    setRemoveImage(false);
  };

  const openCreate = () => {
    resetImageState();
    setEditing(null);
    setForm({ ...emptyForm, category: categories[0] || 'Salad' });
    setFormError('');
  };

  const openEdit = product => {
    resetImageState();
    setEditing(product);
    setForm({ name: product.name, description: product.description, category: product.category, price: (product.priceCents / 100).toFixed(2), stock: String(product.stock), isAvailable: product.isAvailable });
    setImagePreview(displayImage(product) || '');
    setFormError('');
  };

  const closeModal = () => {
    resetImageState();
    setEditing(null);
    setForm(null);
    setFormError('');
    setSaveStage('');
  };

  const update = event => setForm(previous => ({ ...previous, [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const selectImage = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) { setFormError('Choose a JPG, PNG, WebP or AVIF image.'); return; }
    const max = media.maxUploadBytes || MAX_IMAGE_BYTES;
    if (file.size > max) { setFormError(`Image must be smaller than ${Math.round(max / 1024 / 1024)} MB.`); return; }
    if (!media.configured) { setFormError('Cloudinary is not configured on the server yet.'); return; }
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    const url = URL.createObjectURL(file);
    setPreviewObjectUrl(url);
    setImagePreview(url);
    setImageFile(file);
    setRemoveImage(false);
    setFormError('');
  };

  const clearImage = () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    setPreviewObjectUrl('');
    setImagePreview('');
    setImageFile(null);
    setRemoveImage(true);
    setFormError('');
  };

  const save = async event => {
    event.preventDefault();
    setSaving(true);
    setSaveStage('Saving…');
    setFormError('');
    let uploaded = null;
    const body = {
      name: form.name,
      description: form.description,
      category: form.category,
      priceCents: Math.round(Number(form.price) * 100),
      stock: Number(form.stock),
      isAvailable: form.isAvailable,
    };

    try {
      if (imageFile) {
        setSaveStage('Uploading image to Cloudinary…');
        uploaded = await api.uploadProductImage(imageFile);
        body.imageUrl = uploaded.imageUrl;
        body.imagePublicId = uploaded.imagePublicId;
      } else if (removeImage || !editing) {
        body.imageUrl = null;
        body.imagePublicId = null;
      }

      setSaveStage(editing ? 'Updating product…' : 'Creating product…');
      if (editing) await api.updateAdminProduct(editing.id, body);
      else await api.createAdminProduct(body);
      await Promise.all([load(), refreshProducts()]);
      closeModal();
    } catch (requestError) {
      if (uploaded?.imagePublicId) api.cleanupProductImage(uploaded.imagePublicId).catch(() => {});
      setFormError(requestError.message);
    } finally {
      setSaving(false);
      setSaveStage('');
    }
  };

  const toggleAvailability = async product => {
    try {
      if (product.isAvailable) await api.archiveAdminProduct(product.id);
      else await api.updateAdminProduct(product.id, { isAvailable: true });
      await Promise.all([load(), refreshProducts()]);
    } catch (requestError) { setError(requestError.message); }
  };

  const migrateImages = async () => {
    setMigrating(true);
    setMediaMessage('');
    setError('');
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
    {media.configured && media.legacyImageCount > 0 && <button className="button button-secondary" onClick={migrateImages} disabled={migrating}><Icon name="refresh" />{migrating ? 'Moving images…' : `Move ${media.legacyImageCount} images to Cloudinary`}</button>}
    <button className="button button-primary" onClick={openCreate}><Icon name="plus" />Add product</button>
  </div>;

  return <>
    <AdminPageHeader eyebrow="Menu inventory" title={`${products.length} products`} description="Create dishes, control pricing and keep stock accurate. Product image files are stored on Cloudinary; only their URL and public ID are kept in the database." action={headerAction} />
    {!media.configured && <div className="media-notice is-warning"><Icon name="alert" /><div><strong>Cloudinary is not configured</strong><p>Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to the backend environment before uploading product images.</p></div></div>}
    {media.configured && <div className="media-notice"><Icon name="check" /><div><strong>Cloudinary media storage is active</strong><p>New product images upload directly from the browser to Cloudinary, so image bytes do not pass through the API or database.</p></div></div>}
    {mediaMessage && <p className="form-success">{mediaMessage}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-toolbar">
      <label className="admin-search"><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search products or categories…" aria-label="Search products" /></label>
      <select value={availability} onChange={event => setAvailability(event.target.value)} aria-label="Filter availability"><option value="all">All products</option><option value="active">Available</option><option value="archived">Archived</option></select>
    </div>
    <section className="admin-card">
      {visible.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Image</th><th>Status</th><th className="align-right">Actions</th></tr></thead>
        <tbody>{visible.map(product => {
          const image = displayImage(product);
          return <tr key={product.id}>
            <td><div className="product-cell"><span className="product-thumb">{image ? <img src={image} alt="" loading="lazy" /> : <Icon name="products" />}</span><div><strong>{product.name}</strong><small>{product.description}</small></div></div></td>
            <td>{product.category}</td><td><strong>{formatCurrency(product.priceCents / 100)}</strong></td><td><span className={product.stock <= 10 ? 'stock-low' : 'stock-ok'}>{product.stock}</span></td>
            <td><span className={`media-storage-badge ${product.imagePublicId ? 'is-cloud' : ''}`}>{product.imagePublicId ? 'Cloudinary' : image ? 'Legacy' : 'None'}</span></td>
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
        <div className="field-grid"><div className="field"><label htmlFor="product-price">Price</label><input id="product-price" name="price" type="number" required min="0.01" max="100000" step="0.01" value={form.price} onChange={update} /></div><div className="field"><label htmlFor="product-stock">Units in stock</label><input id="product-stock" name="stock" type="number" required min="0" max="1000000" step="1" value={form.stock} onChange={update} /></div></div>
        <div className="field">
          <label>Product image</label>
          <div className="product-image-uploader">
            <div className="product-image-preview">{imagePreview ? <img src={imagePreview} alt="Product preview" /> : <Icon name="products" size={28} />}</div>
            <div className="product-image-copy">
              <strong>{imageFile ? imageFile.name : imagePreview ? 'Current product image' : 'No image selected'}</strong>
              <small>JPG, PNG, WebP or AVIF. Maximum {Math.round((media.maxUploadBytes || MAX_IMAGE_BYTES) / 1024 / 1024)} MB. The browser uploads directly to Cloudinary.</small>
              <div className="product-image-actions">
                <label className={`button button-secondary button-small ${!media.configured ? 'is-disabled' : ''}`}><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={selectImage} disabled={!media.configured || saving} />{imagePreview ? 'Replace image' : 'Choose image'}</label>
                {imagePreview && <button type="button" className="button button-ghost button-small" onClick={clearImage} disabled={saving}>Remove</button>}
              </div>
            </div>
          </div>
        </div>
        <label className="toggle-field"><div><p>Available to customers</p><small>Hidden products remain in order history.</small></div><span className="switch"><input name="isAvailable" type="checkbox" checked={form.isAvailable} onChange={update} /><span /></span></label>
        {saveStage && saving && <p className="upload-stage"><span className="mini-spinner" />{saveStage}</p>}
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="admin-form-footer"><button type="button" className="button button-secondary" onClick={closeModal} disabled={saving}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? saveStage || 'Saving…' : editing ? 'Save changes' : 'Create product'}</button></div>
      </form>
    </AdminModal>}
  </>;
}
