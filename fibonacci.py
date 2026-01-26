def fibonacci(n):
    """Calculate the nth Fibonacci number using iteration."""
    if n <= 0:
        return 0
    elif n == 1:
        return 1
    
    prev, curr = 0, 1
    for _ in range(2, n + 1):
        prev, curr = curr, prev + curr
    
    return curr


# Examples
if __name__ == "__main__":
    print(f"fib(5) = {fibonacci(5)}")
    print(f"fib(10) = {fibonacci(10)}")
    
    # Show the sequence
    print("\nFibonacci sequence (0-10):")
    for i in range(11):
        print(f"fib({i}) = {fibonacci(i)}")
