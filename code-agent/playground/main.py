"""
This module solves the problem of finding the minimum manufacturing cost (P) and the fewest number
of basic units (U) required to produce a target DNA sequence T using given basic unit types.
Each basic unit has its own manufacturing cost and deletion limit Dmax. The solution accounts for
deletions within the allowed limit per unit and ensures the concatenated sequence matches T exactly
without being a mirror image.
"""

from typing import List, Tuple, Dict, Optional
import sys

# Constants for nucleotides
NUCLEOTIDES = {'A', 'C', 'G', 'T'}

class BasicUnit:
    """Represents a basic unit with its properties."""
    
    def __init__(self, sequence: str, cost: int, dmax: int):
        self.sequence = sequence
        self.cost = cost
        self.dmax = dmax
        self.length = len(sequence)

class Solution:
    """Solves the problem of finding the minimum manufacturing cost and unit count."""
    
    def __init__(self, target_sequence: str, basic_units: List[BasicUnit]):
        self.target_sequence = target_sequence
        self.basic_units = basic_units
        self.n = len(target_sequence)
        self.m = len(basic_units)
        self.dp_cost = [float('inf')] * (self.n + 1)  # dp_cost[i]: min cost to produce first i chars of T
        self.dp_units = [float('inf')] * (self.n + 1)  # dp_units[i]: min units to produce first i chars of T
        self.dp_cost[0] = 0  # Base case: cost to produce empty sequence is 0
        self.dp_units[0] = 0  # Base case: units to produce empty sequence is 0
    
    def can_match(self, unit: BasicUnit, target_subsequence: str) -> bool:
        """
        Check if the target_subsequence can be formed by deleting nucleotides from unit.sequence.
        Returns True if possible within Dmax deletions.
        """
        i = j = 0
        deletions = 0
        len_unit = len(unit.sequence)
        len_target = len(target_subsequence)
        
        while i < len_unit and j < len_target:
            if unit.sequence[i] == target_subsequence[j]:
                j += 1
            else:
                deletions += 1
                if deletions > unit.dmax:
                    return False
            i += 1
        
        # If we haven't matched all of target_subsequence, need more deletions
        remaining = len_target - j
        if deletions + remaining > unit.dmax:
            return False
        return True
    
    def solve(self) -> Tuple[Optional[int], Optional[int]]:
        """
        Solves the problem using dynamic programming.
        Returns a tuple (P, U) where P is the minimum cost and U is the fewest units,
or (None, None) if no solution exists.
        """
        for i in range(1, self.n + 1):
            for unit in self.basic_units:
                # Check all possible substrings of T ending at position i
                start = max(0, i - len(unit.sequence))
                for j in range(start, i):
                    target_subseq = self.target_sequence[j:i]
                    if self.can_match(unit, target_subseq):
                        prev_cost = self.dp_cost[j]
                        prev_units = self.dp_units[j]
                        
                        # Update cost and units if a better solution is found
                        if prev_cost + unit.cost < self.dp_cost[i]:
                            self.dp_cost[i] = prev_cost + unit.cost
                            self.dp_units[i] = prev_units + 1
                        elif prev_cost + unit.cost == self.dp_cost[i] and (prev_units + 1) < self.dp_units[i]:
                            self.dp_units[i] = prev_units + 1
        
        if self.dp_cost[self.n] == float('inf'):
            return None, None
        else:
            return self.dp_cost[self.n], self.dp_units[self.n]

def main():
    """Main function to parse input and run the solution."""
    # Example 1
    target_sequence = "ACGTACGTA"
    basic_units = [
        BasicUnit("A", 2, 0),
        BasicUnit("C", 3, 0),
        BasicUnit("G", 4, 0),
        BasicUnit("T", 5, 0),
        BasicUnit("ACGT", 10, 1),
        BasicUnit("CGTA", 12, 1),
    ]
    
    solver = Solution(target_sequence, basic_units)
    P, U = solver.solve()
    print(f"Example 1: P={P}, U={U}")  # Expected: P=23, U=5
    
    # Example 2 (add more examples as needed)
    target_sequence = "ACGT"
    basic_units = [
        BasicUnit("A", 2, 0),
        BasicUnit("C", 3, 0),
        BasicUnit("G", 4, 0),
        BasicUnit("T", 5, 0),
        BasicUnit("ACGT", 10, 0),
    ]
    
    solver = Solution(target_sequence, basic_units)
    P, U = solver.solve()
    print(f"Example 2: P={P}, U={U}")  # Expected: P=10, U=1

if __name__ == "__main__":
    main()
