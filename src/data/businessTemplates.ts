export const BUSINESS_TEMPLATES = [
  { id: 'mobile', name: 'Mobile Accessories', description: 'Phones, chargers & gadgets', categories: ['Chargers','Cables','Earphones','Cases and Glass','Power Banks','Mobile Phones','Accessories'] },
  { id: 'retail', name: 'General Retail', description: 'Everyday retail essentials', categories: ['Household','Personal Care','Stationery','Gifts','Accessories','Miscellaneous'] },
  { id: 'grocery', name: 'Grocery Store', description: 'Food & daily essentials', categories: ['Fruits','Vegetables','Dairy','Beverages','Snacks','Grains','Household'] },
  { id: 'pharmacy', name: 'Pharmacy', description: 'Medicine & healthcare inventory', categories: ['Prescription Medicines','OTC Medicines','First Aid','Personal Care','Medical Devices','Health Supplements'] },
  { id: 'fashion', name: 'Fashion & Clothing', description: 'Clothing, shoes & accessories', categories: ["Men's Clothing","Women's Clothing",'Kidswear','Footwear','Bags','Accessories'] },
  { id: 'electronics', name: 'Electronics', description: 'Devices & appliances', categories: ['Smartphones','Laptops','Televisions','Home Appliances','Computer Accessories','Audio'] },
  { id: 'department', name: 'Department Store', description: 'Multiple departments', categories: ['Grocery','Fashion','Electronics','Home & Kitchen','Beauty','Toys','Stationery'] },
  { id: 'custom', name: 'Other / Custom', description: 'Choose your own categories', categories: [] },
] as const;

export function normalizeCategories(values: readonly string[]): string[] {
  const names = values.map(value => value.trim()).filter(Boolean).filter(value => value.toLowerCase() !== 'all items');
  return ['All Items', ...Array.from(new Map(names.map(name => [name.toLowerCase(), name])).values())];
}
