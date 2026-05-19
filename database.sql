
CREATE DATABASE IF NOT EXISTS texas_holdem;
USE texas_holdem;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    wins INT DEFAULT 0,
    chips INT DEFAULT 1000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE games (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_name VARCHAR(100),
    status ENUM('waiting', 'countdown', 'active', 'finished') DEFAULT 'waiting',
    winner_id INT NULL,
    -- Stored as JSON strings
    deck JSON NULL,
    community_cards JSON NULL,
    pot INT DEFAULT 0,
    current_bet INT DEFAULT 0,
    current_player_index INT DEFAULT 0,
    round ENUM('preflop','flop','turn','river','showdown') DEFAULT 'preflop',
    small_blind_index INT DEFAULT 0,
    countdown_start BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (winner_id) REFERENCES users(id)
);

CREATE TABLE game_players (
    id INT AUTO_INCREMENT PRIMARY KEY,
    game_id INT NOT NULL,
    user_id INT NOT NULL,
    chips INT DEFAULT 1000,
    hole_cards JSON NULL,
    bet_this_round INT DEFAULT 0,
    total_bet INT DEFAULT 0,
    has_acted BOOLEAN DEFAULT FALSE,
    folded BOOLEAN DEFAULT FALSE,
    is_ready BOOLEAN DEFAULT FALSE,
    seat_index INT DEFAULT 0,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE KEY unique_player_game (game_id, user_id)
);
