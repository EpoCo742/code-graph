const products = [
  { id: 'p1', name: 'Widget', price: 10 },
  { id: 'p2', name: 'Gadget', price: 25 },
];

function listProducts() {
  return products;
}

function getProduct(id) {
  return products.find((p) => p.id === id);
}

module.exports = { listProducts, getProduct };
