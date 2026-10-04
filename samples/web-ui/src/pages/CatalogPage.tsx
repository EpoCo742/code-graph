import { useEffect, useState } from 'react';
import { listProducts, type Product } from '../api/catalogClient';

export function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    listProducts().then(setProducts);
  }, []);
  return (
    <ul>
      {products.map((p) => (
        <li key={p.id}>{p.name}</li>
      ))}
    </ul>
  );
}
