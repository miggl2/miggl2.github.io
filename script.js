document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const calculateBtn = document.getElementById('calculate-btn');
    const loadingDiv = document.getElementById('loading');
    const resultsSummaryDiv = document.getElementById('results-summary');
    const gradeSelect = document.getElementById('gem-grade-select');
    const heroPriceInput = document.getElementById('hero-price-input');
    const rarePriceInput = document.getElementById('rare-price-input');
    const advPriceInput = document.getElementById('adv-price-input');
    const pheonCheckbox = document.getElementById('include-pheon-checkbox');
    const crystalPriceSection = document.getElementById('crystal-price-section');
    const crystalPriceInput = document.getElementById('crystal-price-input');
    const resetCheckbox = document.getElementById('use-reset-ticket-checkbox');
    const simulationRunsInput = document.getElementById('simulation-runs-input');

    // --- Event Listeners ---
    calculateBtn.addEventListener('click', runAnalysis);

    // --- Main Analysis Function ---
    function runAnalysis() {
        const grade = gradeSelect.value;
        let gem_market_price = parseFloat(heroPriceInput.value) || 0;
        if (grade === 'rare') gem_market_price = parseFloat(rarePriceInput.value) || 0;
        else if (grade === 'adv') gem_market_price = parseFloat(advPriceInput.value) || 0;

        const use_reset = resetCheckbox.checked;
        const use_pheon = pheonCheckbox.checked;
        const crystal_price = parseFloat(crystalPriceInput.value) || 0;
        const simulation_runs = parseInt(simulationRunsInput.value) || 1000;

        if (gem_market_price <= 0) { alert('선택된 등급의 젬 가격을 올바르게 입력해주세요.'); return; }
        if ((use_pheon || use_reset) && crystal_price <= 0) { alert('크리스탈 가격을 올바르게 입력해주세요.'); return; }
        if (simulation_runs <= 0) { alert('시뮬레이션 횟수는 1 이상이어야 합니다.'); return; }

        document.getElementById('results-container').classList.remove('hidden');
        loadingDiv.classList.remove('hidden');
        resultsSummaryDiv.classList.add('hidden');

        setTimeout(() => {
            const processor = new GemProcessor();
            const results = processor.run(grade, gem_market_price, use_reset, use_pheon, crystal_price, simulation_runs);
            displayResults(results);
        }, 50);
    }

    function displayResults(results) {
        const { gems_per_point, gold_per_point, processing_gold_per_point, breakdown, distribution } = results;
        const formatGold = (value) => isFinite(value) ? `${Math.round(value).toLocaleString('ko-KR')} G` : '∞';

        document.getElementById('gems-per-point').textContent = isFinite(gems_per_point) ? `${gems_per_point.toFixed(2)}개` : '∞';
        document.getElementById('gold-per-point').textContent = formatGold(gold_per_point);
        document.getElementById('processing-gold-per-point').textContent = formatGold(processing_gold_per_point);

        document.getElementById('gem-cost-breakdown').textContent = `- 젬: ${formatGold(breakdown.gem_cost)}`;
        document.getElementById('pheon-cost-breakdown').textContent = `- 페온: ${formatGold(breakdown.pheon_cost)}`;
        document.getElementById('processing-cost-breakdown').textContent = `- 가공: ${formatGold(breakdown.processing_cost)}`;
        document.getElementById('reset-cost-breakdown').textContent = `- 초기화: ${formatGold(breakdown.reset_cost)}`;

        // Display point distribution
        document.getElementById('net-point-2-count').textContent = `2점: ${distribution.two_points.toLocaleString('ko-KR')}개`;
        document.getElementById('net-point-1-count').textContent = `1점: ${distribution.one_point.toLocaleString('ko-KR')}개`;
        document.getElementById('net-point-0-count').textContent = `0점: ${distribution.zero_points.toLocaleString('ko-KR')}개`;
        document.getElementById('net-point-neg-count').textContent = `음수: ${distribution.negative_points.toLocaleString('ko-KR')}개`;

        loadingDiv.classList.add('hidden');
        resultsSummaryDiv.classList.remove('hidden');
    }
});

class GemProcessor {
    constructor() {
        this.PROBABILITY_DATA = {
            willpower: [[+1, 0.1165], [+2, 0.0440], [+3, 0.0175], [+4, 0.0045], [-1, 0.0300]],
            order_chaos: [[+1, 0.1165], [+2, 0.0440], [+3, 0.0175], [+4, 0.0045], [-1, 0.0300]],
            effect: [[+1, 0.1165], [+2, 0.0440], [+3, 0.0175], [+4, 0.0045], [-1, 0.0300]],
            others: { change_effect1: 0.0325, change_effect2: 0.0325, cost_plus_100: 0.0175, cost_minus_100: 0.0175, maintain: 0.0175, reroll_plus_1: 0.0250, reroll_plus_2: 0.0075, }
        };
        this.BASE_GOLD_COST = 900;
        this.PHEON_REQ = { hero: 12, rare: 6, adv: 3 };
        this.ProfitTable = {};
    }

    getNetPoints(stats) { return stats[0] + stats[1] - 8; }

    getOptionDistribution(stats) {
        let distribution = [];
        const addOption = (stat_idx) => {
            const current_stat = stats[stat_idx];
            const options_rules = [
                [+1, 0.1165, 6], [+2, 0.0440, 4],
                [+3, 0.0175, 3], [+4, 0.0045, 2],
                [-1, 0.0300, 0]
            ];
            options_rules.forEach(([change, prob, threshold]) => {
                if (current_stat < threshold && (current_stat + change) >= 1 && (current_stat + change) <= 5) {
                    distribution.push({ type: 'stat', stat_idx, change, prob });
                }
            });
        };
        addOption(0); addOption(1); addOption(2); addOption(3);

        Object.entries(this.PROBABILITY_DATA.others).forEach(([key, prob]) => {
            if (key.startsWith('reroll')) distribution.push({ type: 'reroll_gain', change: parseInt(key.slice(-1)), prob });
            else if (key.startsWith('cost')) distribution.push({ type: 'cost_mod', change: key.includes('plus') ? 1 : -1, prob });
            else distribution.push({ type: key, prob });
        });
        return distribution;
    }

    calculateOptimalProfit(a, r, stats, cpp_guess) {
        const key = `${a},${r},${stats.join(',')}`;
        if (this.ProfitTable[key] !== undefined) return this.ProfitTable[key];
        if (a === 0) return this.getNetPoints(stats) * cpp_guess;

        const distribution = this.getOptionDistribution(stats);
        const totalProb = distribution.reduce((sum, o) => sum + o.prob, 0);
        let profit_roll = 0;
        if (totalProb > 0) {
            distribution.forEach(option => {
                let next_stats = [...stats];
                let next_r = r;
                let cost_of_roll = this.BASE_GOLD_COST;
                if (option.type === 'stat') next_stats[option.stat_idx] += option.change;
                if (option.type === 'reroll_gain') next_r += option.change;
                if (option.type === 'cost_mod') cost_of_roll *= (1 + option.change);
                profit_roll += (option.prob / totalProb) * (this.calculateOptimalProfit(a - 1, next_r, next_stats, cpp_guess) - cost_of_roll);
            });
        }

        const profit_reroll = (r > 0) ? this.calculateOptimalProfit(a, r - 1, stats, cpp_guess) : -Infinity;
        const profit_stop = this.getNetPoints(stats) * cpp_guess;
        
        const best_profit = Math.max(profit_stop, profit_roll, profit_reroll);
        this.ProfitTable[key] = best_profit;
        return best_profit;
    }

    simulateOneGemLifecycle(attempts, rerolls, cpp_guess, use_reset, crystal_price) {
        let stats = [1, 1, 1, 1];
        let r = rerolls;
        let processing_gold = 0;
        let reset_gold = 0;

        for (let a = attempts; a > 0; a--) {
            let action;
            let presented_options = [];
            
            const max_possible_sum = (stats[0] + stats[1]) + 4 * (a - 1);
            if (use_reset && a > 1 && max_possible_sum < 9) {
                action = 'reset';
            } else {
                let possible_options = this.getOptionDistribution(stats);
                for (let i = 0; i < 4 && possible_options.length > 0; i++) {
                    const total_prob = possible_options.reduce((sum, opt) => sum + opt.prob, 0);
                    let rand = Math.random() * total_prob;
                    let chosen_index = -1;
                    for (let j = 0; j < possible_options.length; j++) {
                        rand -= possible_options[j].prob;
                        if (rand < 0) { chosen_index = j; break; }
                    }
                    if (chosen_index !== -1) {
                        presented_options.push(possible_options.splice(chosen_index, 1)[0]);
                    }
                }

                const profit_stop = this.getNetPoints(stats) * cpp_guess;
                const profit_reroll = (r > 0) ? this.ProfitTable[`${a},${r-1},${stats.join(',')}`] : -Infinity;
                
                let profit_roll = -Infinity;
                if (presented_options.length > 0) {
                    let expected_profit_from_set = 0;
                    presented_options.forEach(option => {
                        let next_stats = [...stats];
                        let cost_of_roll = this.BASE_GOLD_COST;
                        if (option.type === 'stat') next_stats[option.stat_idx] += option.change;
                        if (option.type === 'cost_mod') cost_of_roll *= (1 + option.change);
                        expected_profit_from_set += this.ProfitTable[`${a-1},${r},${next_stats.join(',')}`] - cost_of_roll;
                    });
                    profit_roll = expected_profit_from_set / presented_options.length;
                }

                const best_profit = Math.max(profit_stop, profit_roll, profit_reroll);
                
                if (Math.abs(best_profit - profit_stop) < 1e-9) action = 'stop';
                else if (Math.abs(best_profit - profit_reroll) < 1e-9) action = 'reroll';
                else action = 'roll';
            }

            if (action === 'stop') break;
            if (action === 'reroll') { r--; a++; continue; }
            if (action === 'reset') {
                reset_gold += (crystal_price / 95 * 100);
                stats = [1, 1, 1, 1];
                r = rerolls;
                a = attempts + 1;
                continue;
            }

            if (action === 'roll') {
                if (presented_options.length > 0) {
                    const chosen_option = presented_options[Math.floor(Math.random() * presented_options.length)];
                    if (chosen_option.type === 'stat') stats[chosen_option.stat_idx] += chosen_option.change;
                    if (chosen_option.type === 'reroll_gain') r += chosen_option.change;
                    processing_gold += (chosen_option.type === 'cost_mod') ? this.BASE_GOLD_COST * (1 + chosen_option.change) : this.BASE_GOLD_COST;
                }
            }
        }
        return { final_points: this.getNetPoints(stats), processing_gold, reset_gold };
    }

    run(grade, gem_market_price, use_reset, use_pheon, crystal_price, simulation_runs) {
        let pheon_cost = 0;
        if (use_pheon) {
            pheon_cost = (crystal_price / 95 * 8.5) * this.PHEON_REQ[grade];
        }
        const gem_price_with_pheon = gem_market_price + pheon_cost;

        let attempts, rerolls;
        if (grade === 'hero') { attempts = 9; rerolls = 2; }
        else if (grade === 'rare') { attempts = 7; rerolls = 1; }
        else { attempts = 5; rerolls = 0; }

        let cpp_guess = gem_price_with_pheon;
        let cpp_actual = 0;
        let total_gems_consumed = 0, total_processing_gold = 0, total_reset_gold = 0, total_positive_net_points = 0;
        let distribution = { one_point: 0, two_points: 0, zero_points: 0, negative_points: 0 };

        for (let iter = 0; iter < 10; iter++) {
            this.ProfitTable = {};
            this.calculateOptimalProfit(attempts, rerolls, [1,1,1,1], cpp_guess);

            total_gems_consumed = 0; total_processing_gold = 0; total_reset_gold = 0; total_positive_net_points = 0;
            distribution = { one_point: 0, two_points: 0, zero_points: 0, negative_points: 0 };

            for (let i = 0; i < simulation_runs; i++) {
                total_gems_consumed++;
                const { final_points, processing_gold, reset_gold } = this.simulateOneGemLifecycle(attempts, rerolls, cpp_guess, use_reset, crystal_price);
                total_processing_gold += processing_gold;
                total_reset_gold += reset_gold;
                
                if (final_points === 2) distribution.two_points++;
                else if (final_points === 1) distribution.one_point++;
                else if (final_points === 0) distribution.zero_points++;
                else if (final_points < 0) distribution.negative_points++;

                if (final_points > 0) {
                    total_positive_net_points += final_points;
                }
            }

            const total_gem_cost = total_gems_consumed * gem_market_price;
            const total_pheon_cost = total_gems_consumed * pheon_cost;
            const total_cost = total_gem_cost + total_pheon_cost + total_processing_gold + total_reset_gold;
            cpp_actual = total_positive_net_points > 0 ? total_cost / total_positive_net_points : Infinity;

            if (Math.abs(cpp_guess - cpp_actual) < 100) break;
            cpp_guess = cpp_actual;
        }

        const gems_per_point = total_positive_net_points > 0 ? total_gems_consumed / total_positive_net_points : Infinity;
        const processing_gold_per_point = total_positive_net_points > 0 ? (total_processing_gold + total_reset_gold) / total_positive_net_points : Infinity;
        const breakdown = {
            gem_cost: (total_gems_consumed * gem_market_price) / total_positive_net_points,
            pheon_cost: (total_gems_consumed * pheon_cost) / total_positive_net_points,
            processing_cost: total_processing_gold / total_positive_net_points,
            reset_cost: total_reset_gold / total_positive_net_points
        };

        return {
            gems_per_point,
            gold_per_point: cpp_actual,
            processing_gold_per_point,
            breakdown,
            distribution
        };
    }
}
