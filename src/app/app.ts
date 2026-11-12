import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface Named { id: string; name: string }
interface User extends Named { email: string }
interface Session { token: string; user: User }
interface Member { userId: string; name: string; email: string; role: 'OWNER' | 'MEMBER' }
interface Household extends Named { members: Member[] }
interface Product extends Named { category: Named | null }
interface Item { id: string; product: Product; quantity: number; unit: Unit; notes: string | null; completed: boolean; addedBy: User | null }

interface Purchase { id: string; listName: string; buyer: string; createdAt: string; items: { itemId: string; productId: string; name: string; quantity: number; unit: Unit }[] }
interface ReceiptLine { text: string; productId: string | null; quantity: number | null; unit: Unit | null; net: number | null }
interface ReceiptData { store: string; date: string; currency: string; total: number | null; adjustment: number | null; lines: ReceiptLine[] }
interface Receipt { id: string; status: 'QUEUED' | 'PROCESSING' | 'REVIEW' | 'CONFIRMED' | 'FAILED' | 'MANUAL'; data: ReceiptData | null }
interface PriceDifference { productId: string; name: string; unit: Unit; currency: string; currentPrice: number; previousPrice: number | null; basketDifference: number | null; previousDate: string | null; previousStore: string | null }

const units = { UNIT: 'ud.', KG: 'kg', G: 'g', L: 'l', ML: 'ml', PACK: 'paq.' };
type Unit = keyof typeof units;
type Filter = 'all' | 'pending' | 'done';

@Component({
  selector: 'app-root',
  imports: [FormsModule, DatePipe, DecimalPipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly user = signal<User | null>(null);
  protected readonly households = signal<Named[]>([]);
  protected readonly household = signal<Household | null>(null);
  protected readonly lists = signal<Named[]>([]);
  protected readonly list = signal<Named | null>(null);
  protected readonly items = signal<Item[]>([]);
  protected readonly products = signal<Product[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly filter = signal<Filter>('all');
  protected readonly done = computed(() => this.items().filter(item => item.completed).length);
  protected readonly visible = computed(() => this.items().filter(item =>
    this.filter() === 'all' || item.completed === (this.filter() === 'done')));
  protected readonly owner = computed(() => this.household()?.members.some(
    member => member.userId === this.user()?.id && member.role === 'OWNER'));
  protected readonly units = units;
  protected readonly unitOptions = Object.keys(units) as Unit[];
  protected register = false;
  protected name = '';
  protected email = '';
  protected password = '';
  protected homeName = '';
  protected listName = '';
  protected memberId = '';
  protected productName = '';
  protected quantity: number | null = 1;
  protected unit: Unit = 'UNIT';
  protected notes = '';
  protected readonly purchases = signal<Purchase[]>([]);
  protected readonly purchase = signal<Purchase | null>(null);
  protected readonly receipts = signal<Receipt[]>([]);
  protected readonly purchaseProducts = computed(() =>
    [...new Map(this.purchase()?.items.map(item => [item.productId, item])).values()]);
  protected readonly receiptPrices = computed(() => {
    const products = new Map(this.purchaseProducts().map(product => [product.productId, product.name]));
    return this.receipts().flatMap(receipt => (receipt.data?.lines ?? []).filter(line => line != null).map(line => ({
      ...line,
      productName: line.productId ? products.get(line.productId) : undefined,
      currency: receipt.data?.currency,
      confirmed: receipt.status === 'CONFIRMED',
      store: receipt.data?.store,
    })));
  });

  protected readonly prices = signal<PriceDifference[]>([]);
  protected readonly basket = computed(() => {
    const totals = new Map<string, { amount: number; count: number }>();
    for (const price of this.prices()) {
      if (price.basketDifference === null) continue;
      const total = totals.get(price.currency) ?? { amount: 0, count: 0 };
      totals.set(price.currency, { amount: total.amount + price.basketDifference, count: total.count + 1 });
    }
    return Array.from(totals, ([currency, total]) => ({ currency, ...total }));
  });
  protected receiptDraft: ReceiptData | null = null;
  protected editingReceipt = '';
  protected receiptImage = '';
  protected receiptImageId = '';
  private receiptTimer?: ReturnType<typeof setTimeout>;
  private token = sessionStorage.getItem('shopping-token') ?? '';

  constructor() {
    if (this.token) void this.run(async () => {
      this.user.set(await this.api<User>('/auth/me'));
      await this.loadHomes();
    });
  }

  protected authenticate() {
    return this.run(async () => {
      const session = await this.api<Session>(this.register ? '/auth/register' : '/auth/login', 'POST', {
        name: this.name.trim(), email: this.email.trim(), password: this.password,
      });
      this.token = session.token;
      sessionStorage.setItem('shopping-token', this.token);
      this.user.set(session.user);
      this.password = '';
      await this.loadHomes();
    });
  }

  protected logout() {
    this.closePurchase();
    this.purchases.set([]);
    this.token = '';
    sessionStorage.removeItem('shopping-token');
    this.user.set(null);
    this.households.set([]);
    this.household.set(null);
    this.lists.set([]);
    this.list.set(null);
    this.items.set([]);
    this.products.set([]);
    this.error.set('');
    this.notice.set('');
    this.homeName = this.listName = this.memberId = '';
    this.resetItem();
  }

  protected reload() { return this.run(() => this.loadHomes()); }

  protected createHome() {
    return this.run(async () => {
      const name = this.homeName.trim();
      if (!name) throw new Error('Introduce un nombre para el hogar.');
      const home = await this.api<Household>('/households', 'POST', { name });
      this.households.update(homes => [...homes, home]);
      this.homeName = '';
      await this.loadHome(home.id);
    });
  }

  protected selectHome(id: string) { return this.run(() => this.loadHome(id)); }

  protected createList() {
    return this.run(async () => {
      const name = this.listName.trim();
      if (!name) throw new Error('Introduce un nombre para la lista.');
      const list = await this.api<Named>('/households/' + this.household()?.id + '/lists', 'POST', { name });
      this.lists.update(lists => [...lists, list]);
      this.listName = '';
      await this.loadList(list);
    });
  }

  protected selectList(list: Named) { return this.run(() => this.loadList(list)); }

  protected refreshItems() {
    const list = this.list();
    if (list) return this.run(() => this.loadList(list));
    return undefined;
  }

  protected addItem() {
    return this.run(async () => {
      const name = this.productName.trim();
      const quantity = this.quantity;
      if (!name || quantity === null || !Number.isFinite(quantity) || quantity < 0.01) {
        throw new Error('Introduce un producto y una cantidad válida.');
      }
      const catalog = await this.api<Product[]>('/products');
      let product = catalog.find(entry => entry.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'));
      if (!product) {
        product = await this.api<Product>('/products', 'POST', { name, categoryId: null });
        catalog.push(product);
      }
      this.products.set(catalog);
      const item = await this.api<Item>('/lists/' + this.list()?.id + '/items', 'POST', {
        productId: product.id, quantity, unit: this.unit, notes: this.notes.trim() || null,
      });
      this.items.update(items => [...items, item]);
      this.filter.set('all');
      this.resetItem();
    });
  }

  protected toggle(item: Item) {
    return this.run(() => this.setCompleted(item, !item.completed));
  }

  protected markAll() {
    return this.run(async () => {
      const pending = this.items().filter(item => !item.completed);
      for (const item of pending) {
        await this.setCompleted(item, true);
      }
      this.notice.set('Todos los productos están marcados como comprados.');
    });
  }

  private async setCompleted(item: Item, completed: boolean) {
    const updated = await this.api<Item>('/items/' + item.id + '/complete', 'PATCH', { completed });
    this.items.update(items => items.map(entry => entry.id === item.id ? updated : entry));
  }

  protected removeItem(item: Item) {
    if (!confirm('¿Quitar «' + item.product.name + '» de la lista?')) return;
    return this.run(async () => {
      await this.api('/items/' + item.id, 'DELETE');
      this.items.update(items => items.filter(entry => entry.id !== item.id));
    });
  }

  protected addMember() {
    return this.run(async () => {
      const id = this.household()?.id;
      await this.api('/households/' + id + '/members', 'POST', { userId: this.memberId.trim() });
      this.memberId = '';
      this.household.set(await this.api<Household>('/households/' + id));
    });
  }

  protected removeMember(member: Member) {
    if (!confirm('¿Quitar a ' + member.name + ' del hogar?')) return;
    return this.run(async () => {
      await this.api('/households/' + this.household()?.id + '/members/' + member.userId, 'DELETE');
      this.household.update(home => home && { ...home, members: home.members.filter(entry => entry.userId !== member.userId) });
    });
  }

  protected copyId() {
    return this.run(async () => {
      await navigator.clipboard.writeText(this.user()?.id ?? '');
      this.notice.set('Identificador copiado.');
    });
  }

  ngOnDestroy() { this.closePurchase(); }

  protected finishPurchase() {
    const list = this.list();
    if (!list || !this.done() || !confirm('¿Guardar los productos marcados como una compra?')) return;
    return this.run(async () => {
      const purchase = await this.api<Purchase>('/lists/' + list.id + '/purchases', 'POST');
      this.closePurchase();
      this.purchase.set(purchase);
      this.purchases.update(entries => [purchase, ...entries]);
      const purchasedIds = new Set(purchase.items.map(item => item.itemId));
      this.items.update(items => items.filter(item => !purchasedIds.has(item.id)));
      this.filter.set('all');
      this.notice.set('Compra guardada. Puedes adjuntar los tickets desde el historial.');
    });
  }

  protected openPurchase(purchase: Purchase) {
    return this.run(async () => {
      this.closePurchase();
      this.purchase.set(purchase);
      await this.loadPurchase(purchase.id);
    });
  }

  protected closePurchase() {
    clearTimeout(this.receiptTimer);
    this.purchase.set(null);
    this.receipts.set([]);
    this.prices.set([]);
    this.receiptDraft = null;
    this.editingReceipt = '';
    this.clearImage();
  }

  protected uploadReceipts(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const purchase = this.purchase();
    input.value = '';
    if (!purchase || !files.length) return;
    return this.run(async () => {
      try {
        for (const file of files) {
          const form = new FormData();
          form.set('file', await this.compressReceipt(file));
          await this.api('/purchases/' + purchase.id + '/receipts', 'POST', form);
        }
      } finally {
        await this.loadPurchase(purchase.id);
      }
    });
  }

  private async compressReceipt(file: File): Promise<File> {
    const maxBytes = 5 * 1024 * 1024;
    const url = URL.createObjectURL(file);
    try {
      const photo = new Image();
      photo.src = url;
      await photo.decode();

      const scale = Math.min(1, 4096 / Math.max(photo.naturalWidth, photo.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(photo.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(photo.naturalHeight * scale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas no disponible');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(photo, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.88, 0.78, 0.68]) {
        const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!jpeg || jpeg.type !== 'image/jpeg' || jpeg.size > maxBytes) continue;
        if (scale === 1 && file.size <= jpeg.size && ['image/jpeg', 'image/png'].includes(file.type)) return file;
        return new File([jpeg], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: jpeg.type });
      }
    } catch {
      throw new Error('No se pudo preparar la foto «' + file.name + '». Prueba con una imagen JPEG o PNG.');
    } finally {
      URL.revokeObjectURL(url);
    }
    if (file.size <= maxBytes && ['image/jpeg', 'image/png'].includes(file.type)) return file;
    throw new Error('La foto «' + file.name + '» supera los 5 MB después de comprimirla.');
  }


  protected retryReceipt(receipt: Receipt) {
    const purchase = this.purchase();
    if (!purchase) return;
    return this.run(async () => {
      await this.api('/purchases/' + purchase.id + '/receipts/' + receipt.id + '/retry', 'POST');
      await this.loadPurchase(purchase.id);
    });
  }

  protected refreshPurchase() {
    const purchase = this.purchase();
    if (purchase) return this.run(() => this.loadPurchase(purchase.id));
    return undefined;
  }

  protected reviewReceipt(receipt: Receipt) {
    this.editingReceipt = receipt.id;
    const data = receipt.data;
    this.receiptDraft = {
      store: data?.store ?? '', date: data?.date ?? '', currency: data?.currency ?? 'EUR',
      total: data?.total ?? null, adjustment: data?.adjustment ?? 0,
      lines: (data?.lines ?? []).filter(line => line != null).map(line => ({ ...line, text: line.text ?? '' })),
    };
    if (!this.receiptDraft.lines.length) this.addReceiptLine();
  }

  protected addReceiptLine() {
    this.receiptDraft?.lines.push({ text: '', productId: null, quantity: 1, unit: 'UNIT', net: null });
  }

  protected saveReceipt() {
    const purchase = this.purchase();
    const draft = this.receiptDraft;
    if (!purchase || !draft || !draft.lines.length) return;
    return this.run(async () => {
      await this.api('/purchases/' + purchase.id + '/receipts/' + this.editingReceipt, 'PUT', {
        ...draft, store: draft.store.trim(), currency: draft.currency.trim().toUpperCase(),
        lines: draft.lines.map(line => ({ ...line, text: line.text.trim() })),
      });
      this.receiptDraft = null;
      this.editingReceipt = '';
      await this.loadPurchase(purchase.id);
      this.notice.set('Ticket confirmado.');
    });
  }

  protected viewReceipt(receipt: Receipt) {
    const purchase = this.purchase();
    if (!purchase) return;
    return this.run(async () => {
      const response = await fetch('/api/purchases/' + purchase.id + '/receipts/' + receipt.id + '/image',
        { headers: { Authorization: 'Bearer ' + this.token } });
      if (!response.ok) throw new Error('No se pudo abrir el comprobante.');
      const blob = await response.blob();
      this.clearImage();
      this.receiptImage = URL.createObjectURL(blob);
      this.receiptImageId = receipt.id;
    });
  }

  private clearImage() {
    if (this.receiptImage) URL.revokeObjectURL(this.receiptImage);
    this.receiptImage = this.receiptImageId = '';
  }

  private async loadPurchase(id: string) {
    clearTimeout(this.receiptTimer);
    const [receipts, prices] = await Promise.all([
      this.api<Receipt[]>('/purchases/' + id + '/receipts'),
      this.api<PriceDifference[]>('/purchases/' + id + '/comparison'),
    ]);
    this.receipts.set(receipts);
    this.prices.set(prices);
    if (receipts.some(receipt => receipt.status === 'QUEUED' || receipt.status === 'PROCESSING')) {
      this.pollPurchase(id);
    }
  }

  private pollPurchase(id: string) {
    this.receiptTimer = setTimeout(() => {
      if (this.purchase()?.id !== id) return;
      if (this.busy()) this.pollPurchase(id);
      else void this.run(() => this.loadPurchase(id));
    }, 4000);
  }
  private async loadHomes() {
    const homes = await this.api<Named[]>('/households');
    this.households.set(homes);
    const home = homes.find(entry => entry.id === this.household()?.id) ?? homes[0];
    if (home) await this.loadHome(home.id);
    else {
      this.household.set(null);
      this.lists.set([]);
      this.list.set(null);
      this.items.set([]);
    }
  }

  private async loadHome(id: string) {
    const [home, lists, products, purchases] = await Promise.all([
      this.api<Household>('/households/' + id),
      this.api<Named[]>('/households/' + id + '/lists'),
      this.api<Product[]>('/products'),
      this.api<Purchase[]>('/households/' + id + '/purchases'),
    ]);
    const list = lists.find(entry => entry.id === this.list()?.id) ?? lists[0];
    const items = list ? await this.api<Item[]>('/lists/' + list.id + '/items') : [];
    if (this.household()?.id !== home.id) this.closePurchase();
    this.purchases.set(purchases);
    this.household.set(home);
    this.lists.set(lists);
    this.products.set(products);
    this.list.set(list ?? null);
    this.items.set(items);
    this.filter.set('all');
    this.resetItem();
  }

  private async loadList(list: Named) {
    const items = await this.api<Item[]>('/lists/' + list.id + '/items');
    if (this.list()?.id !== list.id) {
      this.filter.set('all');
      this.resetItem();
    }
    this.items.set(items);
    this.list.set(list);
  }

  private resetItem() {
    this.productName = this.notes = '';
    this.quantity = 1;
    this.unit = 'UNIT';
  }

  private async run(action: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try { await action(); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'La operación ha fallado.'); }
    finally { this.busy.set(false); }
  }

  private async api<T = unknown>(path: string, method = 'GET', body?: object): Promise<T> {
    const headers = new Headers();
    if (this.token) headers.set('Authorization', 'Bearer ' + this.token);
    if (body && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
    let response: Response;
    try { response = await fetch('/api' + path, { method, headers, body: body instanceof FormData ? body : body && JSON.stringify(body) }); }
    catch { throw new Error('No se ha podido conectar con el servidor. Vuelve a intentarlo.'); }
    if (!response.ok) {
      if (this.token && (response.status === 401 || (path === '/auth/me' && response.status === 403))) {
        this.logout();
        throw new Error('Tu sesión ha caducado. Vuelve a entrar.');
      }
      const details = await response.json().catch(() => null);
      throw new Error(details?.message ?? details?.detail ?? (response.status === 403
        ? 'No tienes permiso para realizar esta acción.' : 'No se ha podido completar la operación.'));
    }
    const content = await response.text();
    return content ? JSON.parse(content) as T : undefined as T;
  }
}
