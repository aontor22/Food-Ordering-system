import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const names = [
 ['Greek salad','Salad',12],['Veg salad','Salad',18],['Clover Salad','Salad',16],['Chicken Salad','Salad',24],
 ['Lasagna Rolls','Rolls',14],['Peri Peri Rolls','Rolls',12],['Chicken Rolls','Rolls',20],['Veg Rolls','Rolls',15],
 ['Ripple Ice Cream','Deserts',14],['Fruit Ice Cream','Deserts',22],['Jar Ice Cream','Deserts',10],['Vanilla Ice Cream','Deserts',12],
 ['Chicken Sandwich','Sandwich',12],['Vegan Sandwich','Sandwich',18],['Grilled Sandwich','Sandwich',16],['Bread Sandwich','Sandwich',24],
 ['Cup Cake','Cake',14],['Vegan Cake','Cake',12],['Butterscotch Cake','Cake',20],['Sliced Cake','Cake',15],
 ['Garlic Mushroom','Pure Veg',14],['Fried Cauliflower','Pure Veg',22],['Mix Veg Pulao','Pure Veg',10],['Rice Zucchini','Pure Veg',12],
 ['Cheese Pasta','Pasta',12],['Tomato Pasta','Pasta',18],['Creamy Pasta','Pasta',16],['Chicken Pasta','Pasta',24],
 ['Buttered Noodles','Noodles',14],['Veg Noodles','Noodles',12],['Somen Noodles','Noodles',20],['Cooked Noodles','Noodles',15]
];
async function main() {
  for (const [index, [name, category, price]] of names.entries()) await prisma.product.upsert({ where: { id: String(index + 1) }, update: {}, create: { id: String(index + 1), name, category, priceCents: price * 100, stock: 100, description: 'Freshly prepared with quality ingredients', imageUrl: `/food_${index + 1}.png` } });
  await prisma.coupon.upsert({ where: { code: 'WELCOME10' }, update: {}, create: { code: 'WELCOME10', percentOff: 10, minimumCents: 2000 } });
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  await prisma.user.upsert({ where: { email }, update: { role: 'ADMIN' }, create: { name: 'Administrator', email, role: 'ADMIN', passwordHash: await bcrypt.hash(password, 12) } });
  console.log(`Seeded ${names.length} products. Admin: ${email}`);
}
main().finally(() => prisma.$disconnect());
