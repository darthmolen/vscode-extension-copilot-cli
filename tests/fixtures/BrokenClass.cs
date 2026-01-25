using System;
using System.Collections.Generic;
using System.Linq;

namespace TestFixtures
{
    // Missing XML documentation
    public class BrokenClass
    {
        // Wrong naming convention - should be PascalCase
        private string user_name;
        private int userAge;
        
        // Missing 'this.' prefix
        public string Email { get; set; }
        
        // Constructor with missing validation
        public BrokenClass(string name, int age)
        {
            user_name = name; // Should use this. prefix
            userAge = age;
        }
        
        // Method with off-by-one error
        public List<int> GetNumbersUpTo(int max)
        {
            var numbers = new List<int>();
            for(int i = 0; i < max; i++) // Should be i <= max to include max
            {
                numbers.Add(i);
            }
            return numbers;
        }
        
        // Wrong comparison operator
        public bool IsAdult()
        {
            return userAge > 18; // Should be >= 18
        }
        
        // Missing null check and error handling
        public string GetUserInfo(string prefix)
        {
            return prefix + user_name; // No null check on prefix
        }
        
        // Logic bug - wrong calculation
        public double CalculateDiscount(double price, double percentage)
        {
            // Bug: should multiply by (1 - percentage/100), not add
            return price + (price * percentage / 100);
        }
        
        // Missing input validation
        public void SetAge(int age)
        {
            userAge = age; // No validation - age could be negative
        }
        
        // Array index bug
        public string GetFirstLetter(string[] words)
        {
            if(words.Length > 0) // Should check != null first
            {
                return words[0].Substring(0, 1); // No check if words[0] is empty
            }
            return "";
        }
        
        // Inefficient LINQ query
        public int CountAdults(List<BrokenClass> users)
        {
            var adults = users.Where(u => u.IsAdult()).ToList(); // Unnecessary ToList()
            return adults.Count();
        }
        
        // Resource leak - missing disposal
        public string ReadFile(string path)
        {
            var reader = new System.IO.StreamReader(path); // Should use 'using' statement
            var content = reader.ReadToEnd();
            return content;
        }
        
        // Wrong boolean logic
        public bool CanVote(string country)
        {
            // Bug: AND should be OR
            return userAge >= 18 && (country == "US" && country == "UK");
        }
        
        // Missing override and wrong spacing
        public override string ToString(){return user_name+" ("+userAge+")";} // All on one line, no spacing
    }
}
