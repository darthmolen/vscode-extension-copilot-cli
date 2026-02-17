import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

months = ['Jan', 'Feb', 'Mar']
sales = [45, 62, 58]

plt.figure(figsize=(6, 4))
bars = plt.bar(months, sales, color=['#e74c3c', '#3498db', '#2ecc71'])
plt.title('Q1 Monthly Sales')
plt.xlabel('Month')
plt.ylabel('Sales')
plt.ylim(0, max(sales) + 10)

for bar, value in zip(bars, sales):
    plt.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1, str(value),
             ha='center', va='bottom', fontsize=9)

plt.tight_layout()
plt.savefig('images/q1-sales.png', dpi=120)
